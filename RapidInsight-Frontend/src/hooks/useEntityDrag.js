import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  buildInitialLayout,
  buildStarSchemaLayout
} from '../utils/playgroundLayout.js';

const CARD_WIDTH = 220;
const FALLBACK_CARD_HEIGHT = 220;
const LAYOUT_PADDING = 28;

function getEntityId(entity) {
  return (
    entity?.schema_id ||
    entity?.schemaId ||
    entity?.id
  );
}

function readStoredPositions(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useEntityDrag(
  storageKey,
  entities,
  containerWidth,
  containerHeight,
  layoutMode = 'default',
  dataModel = null,
  scale = 1
) {
  const [positions, setPositions] = useState(() => readStoredPositions(storageKey) || {});

  // Ref to the DOM layer that contains all entity cards so we can
  // mutate its transform directly—no React re-render during drag.
  const entitiesLayerRef = useRef(null);

  const dragRef = useRef(null);
  const positionsRef = useRef(positions);
  const dataModelRef = useRef(dataModel);
  const entitiesRef = useRef(entities);
  const scaleRef = useRef(scale);

  useEffect(() => {
    positionsRef.current = positions;
    dataModelRef.current = dataModel;
    entitiesRef.current = entities;
    scaleRef.current = scale;
  }, [positions, dataModel, entities, scale]);

  const persistPositions = useCallback(
    (nextPositions) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(nextPositions));
      } catch {
        // optional persistence
      }
    },
    [storageKey]
  );

  const resetLayout = useCallback(() => {
    if (!entities.length || !containerWidth || !containerHeight) return;

    const nextPositions = layoutMode === 'star'
      ? buildStarSchemaLayout(entities, containerWidth, containerHeight, dataModelRef.current)
      : buildInitialLayout(entities, containerWidth, containerHeight);

    positionsRef.current = nextPositions;
    setPositions(nextPositions);
    persistPositions(nextPositions);
  }, [entities, containerWidth, containerHeight, layoutMode, persistPositions]);

  const centerLayout = useCallback(
    ({
      width = containerWidth,
      height = containerHeight,
      cardElements = [],
    } = {}) => {
      const currentPositions = positionsRef.current;

      const positionedEntities = entities
        .map((entity) => {
          const id = getEntityId(entity);
          return { id, position: currentPositions[id] };
        })
        .filter(
          (entry) =>
            entry.id &&
            entry.position &&
            Number.isFinite(entry.position.x) &&
            Number.isFinite(entry.position.y)
        );

      if (positionedEntities.length === 0 || !width || !height) return;

      const elementSizeMap = new Map(
        cardElements.map((element) => [
          element.dataset.entityId,
          {
            width: element.offsetWidth || CARD_WIDTH,
            height: element.offsetHeight || FALLBACK_CARD_HEIGHT,
          },
        ])
      );

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      positionedEntities.forEach(({ id, position }) => {
        const size = elementSizeMap.get(String(id)) || { width: CARD_WIDTH, height: FALLBACK_CARD_HEIGHT };
        minX = Math.min(minX, position.x);
        minY = Math.min(minY, position.y);
        maxX = Math.max(maxX, position.x + size.width);
        maxY = Math.max(maxY, position.y + size.height);
      });

      const groupWidth = maxX - minX;
      const groupHeight = maxY - minY;
      const targetMinX = Math.max(LAYOUT_PADDING, (width - groupWidth) / 2);
      const topSafeArea = 72;
      const availableHeight = Math.max(0, height - topSafeArea - LAYOUT_PADDING);
      const targetMinY = topSafeArea + Math.max(0, (availableHeight - groupHeight) / 2);
      const deltaX = targetMinX - minX;
      const deltaY = targetMinY - minY;

      const nextPositions = { ...currentPositions };
      positionedEntities.forEach(({ id, position }) => {
        nextPositions[id] = { x: position.x + deltaX, y: position.y + deltaY };
      });

      positionsRef.current = nextPositions;
      setPositions(nextPositions);
      persistPositions(nextPositions);
    },
    [entities, containerWidth, containerHeight, persistPositions]
  );

  // ── Entity Drag ──────────────────────────────────────────────────────────────
  // Instead of calling setPositions on every mousemove (React re-render each frame),
  // we find the entity card's DOM element and move it via style.transform directly.
  // React state is only updated on mouseup, so the component tree is only reconciled once.
  useEffect(() => {
    const handleMove = (event) => {
      const drag = dragRef.current;
      if (!drag) return;

      const currentScale = scaleRef.current || 1;
      const deltaX = (event.clientX - drag.startX) / currentScale;
      const deltaY = (event.clientY - drag.startY) / currentScale;
      
      const x = drag.startItemX + deltaX;
      const y = drag.startItemY + deltaY;

      // Update the DOM element directly — zero React overhead
      if (drag.el) {
        drag.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }

      drag.lastX = x;
      drag.lastY = y;

      // Update relationships (orthogonal paths and line jumps)
      if (window.__updatePlaygroundRelationships && dataModelRef.current) {
        // Construct temporary positions state for the router
        const nextPositions = {
          ...positionsRef.current,
          [drag.id]: { x, y }
        };
        window.__updatePlaygroundRelationships(entitiesRef.current, dataModelRef.current, nextPositions);
      }
    };

    const handleUp = () => {
      const drag = dragRef.current;
      if (!drag) return;

      dragRef.current = null;
      document.body.style.userSelect = '';

      if (drag.lastX !== undefined && drag.lastY !== undefined) {
        const nextPositions = {
          ...positionsRef.current,
          [drag.id]: { x: drag.lastX, y: drag.lastY },
        };
        positionsRef.current = nextPositions;
        setPositions(nextPositions);
        persistPositions(nextPositions);
      }

      // Clean up performance hints only — do NOT touch transform here.
      // React's style prop will reconcile the correct translate3d() value
      // from the committed positions state. Clearing it would undo that.
      if (drag.el) {
        requestAnimationFrame(() => {
          if (drag.el) {
            drag.el.style.willChange = '';
            drag.el.style.zIndex = '';
            drag.el.style.transition = '';
          }
        });
      }
    };

    // Use pointermove for better coalescing on high-DPI / stylus devices
    window.addEventListener('pointermove', handleMove, { passive: true });
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [persistPositions]);

  const bindDrag = useCallback((id) => ({
    onPointerDown: (event) => {
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();

      // Capture pointer so moves/ups always reach this handler even outside the element
      event.currentTarget.setPointerCapture(event.pointerId);

      const current = positionsRef.current[id] || { x: 0, y: 0 };
      document.body.style.userSelect = 'none';

      // Walk up from the drag handle to the card root article [data-playground-entity]
      let el = event.currentTarget;
      while (el && el.dataset?.playgroundEntity !== 'true') {
        el = el.parentElement;
      }

      // Hint the browser that this element will animate
      if (el) {
        el.style.willChange = 'transform';
        el.style.transition = 'none';
        el.style.zIndex = '100';
      }

      dragRef.current = {
        id,
        startX: event.clientX,
        startY: event.clientY,
        startItemX: current.x,
        startItemY: current.y,
        el: el || null,
        lastX: current.x,
        lastY: current.y,
      };
    },
  }), []);

  return { positions, bindDrag, resetLayout, centerLayout, entitiesLayerRef };
}
