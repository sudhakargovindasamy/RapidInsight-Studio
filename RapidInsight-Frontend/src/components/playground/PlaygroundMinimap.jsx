import { forwardRef, useImperativeHandle, useRef, useMemo } from 'react';
import './PlaygroundMinimap.css';

const MINIMAP_W = 240;
const MINIMAP_H = 160;
const WORLD_PAD = 80; // Only small padding needed now since bounds dynamically expand
const CARD_W = 220;
const CARD_H = 165; // approx card height

function computeEntityBounds(entities, positions) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;

  for (const entity of entities) {
    const pos = positions[entity.schema_id];
    if (!pos) continue;
    found = true;
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + CARD_W);
    maxY = Math.max(maxY, pos.y + CARD_H);
  }

  if (!found) return null;

  return { minX, minY, maxX, maxY };
}

const PlaygroundMinimap = forwardRef(function PlaygroundMinimap(
  { entities, positions },
  ref
) {
  const viewportElRef = useRef(null);
  const containerRef = useRef(null);

  // Keep entity bounds and positions in a ref so updateViewport always has fresh values
  const layoutRef = useRef(null);

  const entityBounds = useMemo(
    () => computeEntityBounds(entities, positions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entities, positions]
  );

  layoutRef.current = { entityBounds, positions };

  // Imperative API for real-time zero-React-render updates
  useImperativeHandle(ref, () => ({
    updateViewport(effectivePanX, effectivePanY, scale, canvasW, canvasH) {
      const vpEl = viewportElRef.current;
      const containerEl = containerRef.current;
      const layout = layoutRef.current;
      if (!vpEl || !containerEl || !layout || !layout.entityBounds) return;

      // Viewport bounds in world coords
      const vpWorldX = -effectivePanX / scale;
      const vpWorldY = -effectivePanY / scale;
      const vpWorldW = canvasW / scale;
      const vpWorldH = canvasH / scale;

      // The true world bounds = entities + viewport + padding
      const minX = Math.min(layout.entityBounds.minX, vpWorldX) - WORLD_PAD;
      const minY = Math.min(layout.entityBounds.minY, vpWorldY) - WORLD_PAD;
      const maxX = Math.max(layout.entityBounds.maxX, vpWorldX + vpWorldW) + WORLD_PAD;
      const maxY = Math.max(layout.entityBounds.maxY, vpWorldY + vpWorldH) + WORLD_PAD;

      const worldW = maxX - minX;
      const worldH = maxY - minY;

      const scaleX = MINIMAP_W / worldW;
      const scaleY = MINIMAP_H / worldH;
      const ms = Math.min(scaleX, scaleY);

      // Center the map in the container
      const innerW = worldW * ms;
      const innerH = worldH * ms;
      const offsetX = (MINIMAP_W - innerW) / 2;
      const offsetY = (MINIMAP_H - innerH) / 2;

      // Update Viewport Box
      vpEl.style.left   = `${offsetX + (vpWorldX - minX) * ms}px`;
      vpEl.style.top    = `${offsetY + (vpWorldY - minY) * ms}px`;
      vpEl.style.width  = `${vpWorldW * ms}px`;
      vpEl.style.height = `${vpWorldH * ms}px`;

      // Update Entity Dots directly in DOM
      containerEl.querySelectorAll('.playground-minimap__entity').forEach(dot => {
        const id = dot.dataset.minimapEntity;
        const pos = layout.positions[id];
        if (pos) {
          dot.style.left   = `${offsetX + (pos.x - minX) * ms}px`;
          dot.style.top    = `${offsetY + (pos.y - minY) * ms}px`;
          dot.style.width  = `${CARD_W * ms}px`;
          dot.style.height = `${CARD_H * ms}px`;
        }
      });
    },
  }), []);

  if (!entityBounds) return null;

  return (
    <div
      ref={containerRef}
      className="playground-minimap"
      style={{ width: MINIMAP_W, height: MINIMAP_H }}
      aria-label="Canvas minimap"
    >
      {entities.map(entity => (
        <div
          key={entity.schema_id}
          className="playground-minimap__entity"
          data-minimap-entity={entity.schema_id}
        />
      ))}
      <div ref={viewportElRef} className="playground-minimap__viewport" />
    </div>
  );
});

export default PlaygroundMinimap;
