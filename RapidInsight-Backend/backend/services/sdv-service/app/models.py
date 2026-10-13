"""Request and response shapes.

The caller sends an explicit type for every column. This service never inspects
a column name to decide what it holds - see metadata_builder for why.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from . import config


class ColumnSpec(BaseModel):
    """One column the caller wants SDV to generate."""

    name: str
    sdtype: Literal["numerical", "categorical", "datetime", "boolean"]

    # Only meaningful for datetime. Used both to parse the seed rows and to
    # format the generated values on the way back out.
    datetime_format: str | None = None

    # Only meaningful for numerical. These come from the user's schema, not from
    # the seed rows, so they are enforced separately from SDV's own
    # enforce_min_max_values (which only knows the training range).
    minimum: float | None = None
    maximum: float | None = None

    # Only meaningful for categorical. When present, any generated value outside
    # this list is replaced. Guards enum columns.
    allowed_values: list[Any] | None = None


class ConstraintSpec(BaseModel):
    """A rule that generated rows must obey.

    inequality:         low_column <= high_column (order/delivery, start/end)
    range:              low_column <= middle_column <= high_column
    fixed_combinations: the listed columns may only appear in combinations that
                        occurred in the seed rows

    fixed_combinations is the answer to city/country. A statistical model learns
    that Tokyo and Japan are *correlated*, never that Tokyo *determines* Japan,
    so it will happily emit Tokyo/Brazil some of the time. Measured at 44-51%
    correct pairing without it. It is the right tool whenever one column
    functionally determines another.
    """

    type: Literal["inequality", "range", "fixed_combinations"]

    # inequality / range
    low_column: str | None = None
    high_column: str | None = None
    middle_column: str | None = None
    strict: bool = False

    # fixed_combinations
    columns: list[str] | None = None


class GenerateRequest(BaseModel):
    # Computed by the caller from the schema definition plus the seed rows. This
    # service does not decide when a cache is stale - it only honours the key.
    cache_key: str = Field(min_length=8, max_length=128)

    table_name: str = "seed"
    columns: list[ColumnSpec]
    seed_rows: list[dict[str, Any]]
    num_rows: int = Field(gt=0)

    constraints: list[ConstraintSpec] = Field(default_factory=list)
    synthesizer: Literal["tvae", "gaussian_copula", "ctgan"] = config.DEFAULT_SYNTHESIZER

    # Fixing this makes a run reproducible, which is what lets a bug be
    # reproduced instead of merely described.
    random_seed: int | None = None

    @field_validator("columns")
    @classmethod
    def _check_columns(cls, columns: list[ColumnSpec]) -> list[ColumnSpec]:
        if not columns:
            raise ValueError("At least one column is required.")

        if len(columns) > config.MAX_COLUMNS:
            raise ValueError(
                f"{len(columns)} columns exceeds the limit of {config.MAX_COLUMNS}."
            )

        names = [column.name for column in columns]

        if len(names) != len(set(names)):
            raise ValueError("Duplicate column names.")

        return columns

    @field_validator("num_rows")
    @classmethod
    def _check_num_rows(cls, num_rows: int) -> int:
        if num_rows > config.MAX_SAMPLE_ROWS:
            raise ValueError(
                f"num_rows {num_rows} exceeds the limit of {config.MAX_SAMPLE_ROWS}."
            )

        return num_rows


class FitRequest(BaseModel):
    """Train and cache a model without sampling from it.

    Used to warm the cache at schema-upload time, so the Generate Tables click
    finds a model already fitted.
    """

    cache_key: str = Field(min_length=8, max_length=128)
    table_name: str = "seed"
    columns: list[ColumnSpec]
    seed_rows: list[dict[str, Any]]
    constraints: list[ConstraintSpec] = Field(default_factory=list)
    synthesizer: Literal["tvae", "gaussian_copula", "ctgan"] = config.DEFAULT_SYNTHESIZER
    random_seed: int | None = None


class SampleRequest(BaseModel):
    """Draw rows from a model that has already been fitted."""

    cache_key: str = Field(min_length=8, max_length=128)
    num_rows: int = Field(gt=0)
    random_seed: int | None = None

    @field_validator("num_rows")
    @classmethod
    def _check_num_rows(cls, num_rows: int) -> int:
        if num_rows > config.MAX_SAMPLE_ROWS:
            raise ValueError(
                f"num_rows {num_rows} exceeds the limit of {config.MAX_SAMPLE_ROWS}."
            )

        return num_rows


class QualityReport(BaseModel):
    # SDV's own scores, 0..1. Recorded at fit time and carried on the artifact so
    # a cached model can still report how good it was.
    score: float | None = None
    diagnostic: float | None = None


class ModelInfo(BaseModel):
    cache_key: str
    cache_hit: bool
    synthesizer: str
    seed_row_count: int
    fitted_in_ms: int | None = None


class GenerateResponse(BaseModel):
    success: bool = True
    rows: list[dict[str, Any]]
    num_rows: int
    model: ModelInfo
    quality: QualityReport
    warnings: list[str] = Field(default_factory=list)


class FitResponse(BaseModel):
    success: bool = True
    model: ModelInfo
    quality: QualityReport
    warnings: list[str] = Field(default_factory=list)


class SampleResponse(BaseModel):
    success: bool = True
    rows: list[dict[str, Any]]
    num_rows: int
    model: ModelInfo
    warnings: list[str] = Field(default_factory=list)