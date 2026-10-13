"""Two-tier cache for fitted synthesizers.

Disk holds the pickles so a restart does not throw away training. A small
in-memory LRU sits in front, because loading a pickle costs enough (~100ms) to
be noticeable when a caller samples the same table repeatedly.

Per-key locks matter more than they look. Two requests for the same uncached
model arriving together would otherwise both train it - doubling the CPU cost to
produce two identical artifacts, one of which immediately overwrites the other.
"""

import json
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

from . import config

# The cache key reaches the filesystem, so it must not be able to escape the
# artifact directory. Callers send a hex digest; anything else is refused.
_SAFE_KEY = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


class InvalidCacheKey(ValueError):
    pass


@dataclass
class CachedModel:
    synthesizer: object
    meta: dict


class SynthesizerCache:
    def __init__(self) -> None:
        self._memory: OrderedDict[str, CachedModel] = OrderedDict()
        self._memory_lock = threading.Lock()

        self._key_locks: dict[str, threading.Lock] = {}
        self._key_locks_guard = threading.Lock()

        config.ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    # -- locking ---------------------------------------------------------

    def lock_for(self, cache_key: str) -> threading.Lock:
        """One lock per cache key, created on first use."""
        with self._key_locks_guard:
            if cache_key not in self._key_locks:
                self._key_locks[cache_key] = threading.Lock()

            return self._key_locks[cache_key]

    # -- paths -----------------------------------------------------------

    def _validate(self, cache_key: str) -> str:
        if not _SAFE_KEY.match(cache_key or ""):
            raise InvalidCacheKey(
                "cache_key must be 8-128 characters of [A-Za-z0-9_-]."
            )

        return cache_key

    def _model_path(self, cache_key: str) -> Path:
        return config.ARTIFACT_DIR / f"{self._validate(cache_key)}.pkl"

    def _meta_path(self, cache_key: str) -> Path:
        return config.ARTIFACT_DIR / f"{self._validate(cache_key)}.json"

    # -- reads -----------------------------------------------------------

    def get(self, cache_key: str) -> CachedModel | None:
        self._validate(cache_key)

        with self._memory_lock:
            if cache_key in self._memory:
                self._memory.move_to_end(cache_key)
                return self._memory[cache_key]

        return self._load_from_disk(cache_key)

    def _load_from_disk(self, cache_key: str) -> CachedModel | None:
        model_path = self._model_path(cache_key)
        meta_path = self._meta_path(cache_key)

        if not model_path.exists() or not meta_path.exists():
            return None

        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            synthesizer = _load_synthesizer(meta.get("synthesizer"), model_path)
        except Exception:
            # A pickle written by a different SDV version, or a half-written
            # file from a killed process. Either way it is unusable and the
            # correct response is to retrain, not to crash the request.
            self.evict(cache_key)
            return None

        cached = CachedModel(synthesizer=synthesizer, meta=meta)
        self._remember(cache_key, cached)

        return cached

    # -- writes ----------------------------------------------------------

    def put(self, cache_key: str, synthesizer, meta: dict) -> None:
        model_path = self._model_path(cache_key)
        meta_path = self._meta_path(cache_key)

        # Write to a temporary name first. A process killed mid-write would
        # otherwise leave a truncated pickle that looks valid to exists().
        temp_model = model_path.with_suffix(".pkl.tmp")
        temp_meta = meta_path.with_suffix(".json.tmp")

        synthesizer.save(str(temp_model))
        temp_meta.write_text(json.dumps(meta, indent=2), encoding="utf-8")

        temp_model.replace(model_path)
        temp_meta.replace(meta_path)

        self._remember(cache_key, CachedModel(synthesizer=synthesizer, meta=meta))
        self._evict_disk_if_needed()

    def _remember(self, cache_key: str, cached: CachedModel) -> None:
        with self._memory_lock:
            self._memory[cache_key] = cached
            self._memory.move_to_end(cache_key)

            while len(self._memory) > config.MEMORY_CACHE_SIZE:
                self._memory.popitem(last=False)

    # -- eviction --------------------------------------------------------

    def evict(self, cache_key: str) -> None:
        with self._memory_lock:
            self._memory.pop(cache_key, None)

        for path in (self._model_path(cache_key), self._meta_path(cache_key)):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass

    def _evict_disk_if_needed(self) -> None:
        models = sorted(
            config.ARTIFACT_DIR.glob("*.pkl"),
            key=lambda path: path.stat().st_mtime,
        )

        excess = len(models) - config.ARTIFACT_MAX_COUNT

        for path in models[:excess] if excess > 0 else []:
            self.evict(path.stem)

    # -- introspection ---------------------------------------------------

    def stats(self) -> dict:
        return {
            "in_memory": len(self._memory),
            "on_disk": len(list(config.ARTIFACT_DIR.glob("*.pkl"))),
            "artifact_dir": str(config.ARTIFACT_DIR),
        }


def _load_synthesizer(name: str | None, path: Path):
    from sdv.single_table import (
        CTGANSynthesizer,
        GaussianCopulaSynthesizer,
        TVAESynthesizer,
    )

    classes = {
        "gaussian_copula": GaussianCopulaSynthesizer,
        "ctgan": CTGANSynthesizer,
        "tvae": TVAESynthesizer,
    }

    synthesizer_class = classes.get(name or "", GaussianCopulaSynthesizer)

    return synthesizer_class.load(str(path))


cache = SynthesizerCache()