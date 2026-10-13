import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import PlaygroundEntityCard from "./PlaygroundEntityCard";
import PlaygroundInfoButton from "./PlaygroundInfoButton";
import PlaygroundMinimap from "./PlaygroundMinimap";
import { useEntityDrag } from "../../hooks/useEntityDrag";
import "../../utils/relationshipRouting.js";
import "./PlaygroundCanvas.css";

const MIN_SCALE = 0.35;
const MAX_SCALE = 3;
const ZOOM_SENSITIVITY = 0.0012;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeTableName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9_]+/g, '');
}

export default function PlaygroundCanvas({
  projectId,
  entities,
  dataModel,
  layoutMode,
  onToggleLayout,
  loading,
  generatingBySchemaId,
  onGenerate,
  onViewTable,
  onRefresh,
}) {
  const storageKey = `ris-playground-layout-${projectId}`;
  const [isFullScreen, setIsFullScreen] = useState(false);

  // ── Viewport state (committed values used by React for rendering) ──────────
  // These are only updated on pointerup/wheel — not during live pan.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);

  const canvasRef = useRef(null);
  const entitiesLayerRef = useRef(null);
  const svgLayerRef = useRef(null);
  const gridLayerRef = useRef(null);
  const minimapRef = useRef(null);

  // Mutable viewport ref — always up-to-date, zero React renders
  const viewportRef = useRef({ pan: { x: 0, y: 0 }, scale: 1, fsOffset: { x: 0, y: 0 } });
  // Tracks canvas pixel size for use inside applyViewport (a callback with no deps)
  const canvasSizeRef = useRef({ width: 0, height: 0 });

  const normalCanvasSizeRef = useRef({ width: 0, height: 0 });
  const [fullscreenOffset, setFullscreenOffset] = useState({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Keep viewportRef in sync with committed state
  useEffect(() => {
    viewportRef.current.pan = pan;
    viewportRef.current.scale = scale;
  }, [pan, scale]);

  // ── Canvas size tracking ──────────────────────────────────────────────────
  useEffect(() => {
    // Determine the layout constraints on mount and resize
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasSize({ width, height });
        canvasSizeRef.current = { width, height };
        if (!isFullScreen) {
          normalCanvasSizeRef.current = { width, height };
        } else {
          // If entering fullscreen, compute centering offset relative to normal size
          const nW = normalCanvasSizeRef.current.width;
          const nH = normalCanvasSizeRef.current.height;
          const fsO = { x: (width - nW) / 2, y: (height - nH) / 2 };
          setFullscreenOffset(fsO);
          viewportRef.current.fsOffset = fsO;
        }
      }
    });
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [isFullScreen]);

  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    if (!isFullScreen) return;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [isFullScreen]);

  // ── Entity drag (positions managed by hook) ───────────────────────────────
  const { positions, bindDrag, resetLayout } = useEntityDrag(
    storageKey, entities, canvasSize.width, canvasSize.height, layoutMode, dataModel, scale
  );

  useEffect(() => {
    if (canvasSize.width > 0 && canvasSize.height > 0) resetLayout();
  }, [layoutMode, canvasSize.width, canvasSize.height, resetLayout]);

  // Sync minimap viewport whenever committed pan/scale/canvasSize settle
  // (this covers initial load, layout reset, and drops)
  useEffect(() => {
    const vp = viewportRef.current;
    const tx = vp.pan.x + vp.fsOffset.x;
    const ty = vp.pan.y + vp.fsOffset.y;
    minimapRef.current?.updateViewport(tx, ty, vp.scale, canvasSize.width, canvasSize.height);
  }, [pan, scale, canvasSize, fullscreenOffset, positions]);

  // Sync relationships routing (orthogonal paths + line jumps) whenever positions change
  useEffect(() => {
    if (window.__updatePlaygroundRelationships) {
      // Need a small timeout to ensure DOM nodes (entity cards and field rows) have been
      // fully rendered by React before we try to measure their offsets.
      const timer = setTimeout(() => {
        window.__updatePlaygroundRelationships(entities, dataModel, positions);
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [entities, dataModel, positions, layoutMode]);

  // ── Core helper: apply viewport transform to all moveable DOM layers ───────
  // This is called directly from pointer/wheel handlers — zero React renders.
  const applyViewport = useCallback((panX, panY, sc, fsX, fsY) => {
    const tx = panX + fsX;
    const ty = panY + fsY;
    const transform = `translate3d(${tx}px,${ty}px,0) scale(${sc})`;

    if (entitiesLayerRef.current) {
      entitiesLayerRef.current.style.transform = transform;
    }
    if (svgLayerRef.current) {
      svgLayerRef.current.style.transform = transform;
    }
    if (gridLayerRef.current) {
      gridLayerRef.current.style.backgroundPosition = `${tx}px ${ty}px`;
      gridLayerRef.current.style.backgroundSize = `${24 * sc}px ${24 * sc}px`;
    }
    // Update minimap viewport indicator in real-time — no React overhead
    const cs = canvasSizeRef.current;
    minimapRef.current?.updateViewport(tx, ty, sc, cs.width, cs.height);
  }, []);

  // ── Pan-by-pointer drag ────────────────────────────────────────────────────
  // Stores pointer info — no state involved.
  const panDragRef = useRef(null);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const drag = panDragRef.current;
      if (!drag) return;

      const vp = viewportRef.current;
      const nextPanX = drag.initialPanX + event.clientX - drag.startX;
      const nextPanY = drag.initialPanY + event.clientY - drag.startY;

      // Mutate viewportRef so wheel handler stays in sync
      viewportRef.current.pan = { x: nextPanX, y: nextPanY };

      // Write directly to DOM — no React setState, no reconciliation
      applyViewport(nextPanX, nextPanY, vp.scale, vp.fsOffset.x, vp.fsOffset.y);
    };

    const handlePointerUp = () => {
      const drag = panDragRef.current;
      if (!drag) return;

      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      panDragRef.current = null;

      // Commit to React at the very end
      const vp = viewportRef.current;
      setPan(vp.pan);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [applyViewport]);

  const handleCanvasPointerDown = useCallback((event) => {
    if (
      event.button !== 0 ||
      event.target.closest('[data-playground-entity="true"]') ||
      event.target.closest('.canvas-actions') ||
      event.target.closest('.canvas-header') ||
      event.target.closest('.canvas-field-legend')
    ) return;

    event.preventDefault();
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    const vp = viewportRef.current;
    panDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      initialPanX: vp.pan.x,
      initialPanY: vp.pan.y,
    };
  }, []);

  // ── Pinch / wheel zoom ─────────────────────────────────────────────────────
  const handleCanvasWheel = useCallback((event) => {
    event.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const vp = viewportRef.current;
    const factor = Math.exp(-event.deltaY * ZOOM_SENSITIVITY);
    const nextScale = clamp(vp.scale * factor, MIN_SCALE, MAX_SCALE);
    if (nextScale === vp.scale) return;

    const tx = vp.fsOffset.x + vp.pan.x;
    const ty = vp.fsOffset.y + vp.pan.y;
    const worldX = (mouseX - tx) / vp.scale;
    const worldY = (mouseY - ty) / vp.scale;
    const nextPanX = mouseX - vp.fsOffset.x - worldX * nextScale;
    const nextPanY = mouseY - vp.fsOffset.y - worldY * nextScale;
    const nextPan = { x: nextPanX, y: nextPanY };

    viewportRef.current.pan = nextPan;
    viewportRef.current.scale = nextScale;

    applyViewport(nextPanX, nextPanY, nextScale, vp.fsOffset.x, vp.fsOffset.y);

    // Commit to React (single re-render for SVG relationship lines etc.)
    setPan(nextPan);
    setScale(nextScale);
  }, [applyViewport]);

  // Attach wheel listener imperatively so we can use { passive: false }
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleCanvasWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleCanvasWheel);
  }, [handleCanvasWheel]);

  const toggleFullScreen = () => setIsFullScreen((prev) => !prev);

  const handleResetLayout = () => {
    resetLayout();
    const nextPan = { x: 0, y: 0 };
    viewportRef.current.pan = nextPan;
    viewportRef.current.scale = 1;
    setPan(nextPan);
    setScale(1);
    const fsO = viewportRef.current.fsOffset;
    applyViewport(0, 0, 1, fsO.x, fsO.y);
  };

  // Committed transform string (used as initial / fallback for SSR / first paint)
  const tx = pan.x + fullscreenOffset.x;
  const ty = pan.y + fullscreenOffset.y;
  const transformStr = `translate3d(${tx}px,${ty}px,0) scale(${scale})`;

  return (
    <section
      ref={canvasRef}
      className={[
        'playground-canvas',
        isFullScreen ? 'playground-canvas--fullscreen' : '',
        loading ? 'playground-canvas--loading' : '',
        !entities.length && !loading ? 'playground-canvas--empty' : '',
      ].join(' ')}
      aria-label="Schema playground canvas"
      onPointerDown={handleCanvasPointerDown}
    >
      {loading ? (
        <div className="canvas-empty-state">Loading schemas into playground...</div>
      ) : !entities.length ? (
        <div className="canvas-empty-state">
          <h3>No schema entities found</h3>
          <p>Upload or build schemas first, then return to the playground.</p>
        </div>
      ) : (
        <>
          <div className="canvas-header">
            <span className="canvas-logo-icon">🧩</span>
            <span className="canvas-logo-text">Schema Playground</span>
          </div>

          <div className="canvas-actions">
            <PlaygroundInfoButton />
            <button type="button" className="canvas-refresh-btn" onClick={onRefresh} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" className="canvas-reset-btn" onClick={handleResetLayout}>
              Reset layout
            </button>
            <button type="button" className="canvas-fullscreen-btn" onClick={toggleFullScreen}>
              {isFullScreen ? "Exit Full Screen" : "Full Screen"}
            </button>
            {onToggleLayout && (
              <div className="canvas-view-group">
                <span className="canvas-view-label">View:</span>
                <div 
                  className={`canvas-layout-toggle ${layoutMode === 'star' ? 'is-star' : 'is-default'}`} 
                  onClick={onToggleLayout}
                  title="Toggle between default layout and Star Schema view"
                >
                  <div className="toggle-slider"></div>
                  <span className="toggle-label default-label">Default</span>
                  <span className="toggle-label star-label">Star Schema</span>
                </div>
              </div>
            )}
            <button type="button" className="canvas-reset-btn" disabled title="Coming soon: generate analytics-ready reports">
              Run Analytics
            </button>
          </div>

          {/* Grid — background-position updated directly in applyViewport */}
          <div
            ref={gridLayerRef}
            className="canvas-grid"
            style={{
              backgroundPosition: `${tx}px ${ty}px`,
              backgroundSize: `${24 * scale}px ${24 * scale}px`,
            }}
          />

          {/* Relationship lines */}
          <svg
            ref={svgLayerRef}
            className="canvas-relationships"
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: '100%',
              pointerEvents: 'none',
              overflow: 'visible',
              transform: transformStr,
              transformOrigin: '0 0',
            }}
          >
            {dataModel?.relationships?.map((rel, i) => {
              const srcEntity = entities.find(e => normalizeTableName(e.tableName) === normalizeTableName(rel.from_table));
              const dstEntity = entities.find(e => normalizeTableName(e.tableName) === normalizeTableName(rel.to_table));
              if (!srcEntity || !dstEntity) return null;

              const srcPos = positions?.[srcEntity.schema_id];
              const dstPos = positions?.[dstEntity.schema_id];
              if (!srcPos || !dstPos) return null;

              return (
                <path
                  key={`rel-${i}`}
                  id={`rel-path-${i}`}
                  data-rel-from={srcEntity.schema_id}
                  data-rel-to={dstEntity.schema_id}
                  fill="none"
                  stroke={
                    [
                      '#b283f5', // Primary purple
                      '#4ade80', // Vibrant green
                      '#f472b6', // Vibrant pink
                      '#38bdf8', // Vibrant blue
                      '#fbbf24', // Amber
                      '#a78bfa', // Violet
                      '#2dd4bf', // Teal
                      '#f87171'  // Red
                    ][i % 8]
                  }
                  strokeWidth="2.5"
                  opacity="0.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}
          </svg>

          {/* Entity cards layer */}
          <div
            ref={entitiesLayerRef}
            className="canvas-entities"
            style={{ transform: transformStr, transformOrigin: '0 0' }}
          >
            {entities.map((entity, index) => {
              const fallback = { x: 40 + index * 30, y: 40 + index * 24 };
              const position = positions?.[entity.schema_id] || fallback;

              return (
                <PlaygroundEntityCard
                  key={entity.schema_id}
                  entity={entity}
                  position={position}
                  dragBind={bindDrag(entity.schema_id)}
                  isGenerating={Boolean(generatingBySchemaId?.[entity.schema_id])}
                  onGenerate={() => onGenerate?.(entity)}
                  onViewTable={() => onViewTable?.(entity)}
                />
              );
            })}
          </div>

          <PlaygroundMinimap
            ref={minimapRef}
            entities={entities}
            positions={positions}
          />

          <div className="canvas-field-legend" aria-label="Column constraint legend">
            <span className="canvas-field-legend__item">
              <span className="canvas-field-legend__icon canvas-field-legend__icon--fact">ƒ</span>
              Fact
            </span>
            <span className="canvas-field-legend__item">
              <span className="canvas-field-legend__icon canvas-field-legend__icon--dimension">⬡</span>
              Dimension
            </span>
            <span className="canvas-field-legend__item">
              <span className="canvas-field-legend__icon canvas-field-legend__icon--pk" style={{ display: 'flex', alignItems: 'center' }}>
                <svg className="pk-icon-dark" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline-block' }}>
                  <path d="M15 13a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12.5 10.5 4 19v3h3v-2h2v-2h2l1.5-1.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor"/>
                </svg>
                <svg className="pk-icon-light" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'none' }}>
                  <circle cx="12" cy="12" r="12" fill="#3B82F6"/>
                  <path d="M16 6C14.3 6 13 7.3 13 9C13 9.6 13.2 10.1 13.5 10.6L7 17.1V19H8.9L10 17.9L11.1 19H13V17.1L15.4 14.7C15.9 14.9 16.4 15 17 15C18.7 15 20 13.7 20 12C20 10.3 18.7 9 17 9C16.4 9 15.9 9.1 15.4 9.4L16.5 8.3C16.8 8.6 17.3 8.6 17.6 8.3C17.9 8 17.9 7.5 17.6 7.2L16.8 6.4C16.6 6.2 16.3 6 16 6Z" fill="#FDE047"/>
                  <path d="M17 11C16.4 11 16 10.6 16 10C16 9.4 16.4 9 17 9C17.6 9 18 9.4 18 10C18 10.6 17.6 11 17 11Z" fill="#3B82F6"/>
                </svg>
              </span>
              Primary key
            </span>
            <span className="canvas-field-legend__item">
              <span className="canvas-field-legend__icon">#</span>
              Identity
            </span>
            <span className="canvas-field-legend__item">
              <span className="canvas-field-legend__icon canvas-field-legend__icon--unique" style={{ display: 'flex', alignItems: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="24" height="24" rx="4" fill="#647B8C" />
                  <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4 M14 13.12c0 2.38 0 6.38-1 8.88 M17.29 21.02c.12-.6.43-2.3.5-3.02 M6 12a6 6 0 0 1 12 0 M6 16h.01 M18 16c.2-2 .131-5.354 0-6 M8.65 22c.21-.66.45-1.32.57-2 M9 6.8a6 6 0 0 1 9 5.2v2" stroke="black" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
              </span>
              Unique
            </span>
            <span className="canvas-field-legend__item">
              <span className="canvas-field-legend__icon">◇</span>
              Nullable
            </span>
            <span className="canvas-field-legend__item">
              <span className="canvas-field-legend__icon canvas-field-legend__icon--filled">◆</span>
              Non-Nullable
            </span>
          </div>
        </>
      )}
    </section>
  );
}
