// Utility for computing orthogonal (Manhattan) edge paths and intersection jumps

function isBetween(val, a, b) {
  return val >= Math.min(a, b) && val <= Math.max(a, b);
}

function getIntersection(hLine, vLine) {
  // Use a strict inner bound (1px padding) so corners and branching points 
  // don't trigger bridge jumps (which cause the ugly 'knot' artifacts).
  const hMin = Math.min(hLine.x1, hLine.x2) + 1;
  const hMax = Math.max(hLine.x1, hLine.x2) - 1;
  const vMin = Math.min(vLine.y1, vLine.y2) + 1;
  const vMax = Math.max(vLine.y1, vLine.y2) - 1;
  
  if (vLine.x > hMin && vLine.x < hMax && hLine.y > vMin && hLine.y < vMax) {
    return { x: vLine.x, y: hLine.y };
  }
  return null;
}

function verticalSegmentHitsCard(x, y1, y2, cardRects, excludeIds) {
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  for (const rect of cardRects) {
    if (excludeIds.has(rect.id)) continue;
    if (x >= rect.left - 4 && x <= rect.right + 4 && maxY > rect.top + 4 && minY < rect.bottom - 4) {
      return true;
    }
  }
  return false;
}

function findSafeMidX(x1, y1, x2, y2, cardRects, excludeIds, startSide, endSide) {
  let naturalMid;
  if (startSide === 'right' && endSide === 'right') {
    naturalMid = Math.max(x1, x2) + 24;
  } else if (startSide === 'left' && endSide === 'left') {
    naturalMid = Math.min(x1, x2) - 24;
  } else {
    naturalMid = (x1 + x2) / 2;
  }

  const candidates = [naturalMid];
  for (const rect of cardRects) {
    if (excludeIds.has(rect.id)) continue;
    candidates.push(rect.left - 20, rect.right + 20);
  }
  candidates.sort((a, b) => Math.abs(a - naturalMid) - Math.abs(b - naturalMid));
  for (const midX of candidates) {
    if (!verticalSegmentHitsCard(midX, y1, y2, cardRects, excludeIds)) return midX;
  }
  return Math.min(...cardRects.map(r => r.left)) - 60;
}

export function computeOrthogonalPath(x1, y1, x2, y2, midX, stepDownStart = 0, stepDownEnd = 0, startSide = 'right', endSide = 'left') {
  const STEP_ARM = 16; // Length of the short horizontal stem of the T-junction
  const pts = [];

  // Start point
  pts.push({ x: x1, y: y1 });

  // Start T-junction step
  const startStepX = startSide === 'right' ? x1 + STEP_ARM : x1 - STEP_ARM;
  const startSteppedY = y1 + stepDownStart;
  
  if (Math.abs(stepDownStart) >= 1) {
    pts.push({ x: startStepX, y: y1 });
    pts.push({ x: startStepX, y: startSteppedY });
  }

  // Vertical corridor
  pts.push({ x: midX, y: startSteppedY });
  pts.push({ x: midX, y: y2 + stepDownEnd });

  // End T-junction step
  const endStepX = endSide === 'right' ? x2 + STEP_ARM : x2 - STEP_ARM;
  const endSteppedY = y2 + stepDownEnd;
  
  if (Math.abs(stepDownEnd) >= 1) {
    pts.push({ x: endStepX, y: endSteppedY });
    pts.push({ x: endStepX, y: y2 });
  }

  // End point
  pts.push({ x: x2, y: y2 });

  return pts;
}

function buildSegments(pts) {
  const hSegments = [], vSegments = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y === pts[i - 1].y) {
      hSegments.push({ y: pts[i].y, x1: pts[i - 1].x, x2: pts[i].x });
    } else {
      vSegments.push({ x: pts[i].x, y1: pts[i - 1].y, y2: pts[i].y });
    }
  }
  return { hSegments, vSegments };
}

export function generateSVGPath(pts, jumps = [], radius = 8) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], curr = pts[i];
    const isH = curr.y === prev.y, isV = curr.x === prev.x;

    const segJumps = jumps
      .filter(j => isH ? j.y === curr.y && isBetween(j.x, prev.x, curr.x)
                       : isV ? j.x === curr.x && isBetween(j.y, prev.y, curr.y) : false)
      .sort((a, b) => (Math.abs(a.x - prev.x) + Math.abs(a.y - prev.y)) -
                      (Math.abs(b.x - prev.x) + Math.abs(b.y - prev.y)));

    const JR = 6;
    for (const j of segJumps) {
      if (isH) {
        const dir = curr.x > prev.x ? 1 : -1;
        d += ` L ${j.x - JR * dir} ${curr.y} A ${JR} ${JR} 0 0 ${dir > 0 ? 0 : 1} ${j.x + JR * dir} ${curr.y}`;
      } else {
        const dir = curr.y > prev.y ? 1 : -1;
        d += ` L ${curr.x} ${j.y - JR * dir} A ${JR} ${JR} 0 0 ${dir > 0 ? 0 : 1} ${curr.x} ${j.y + JR * dir}`;
      }
    }

    if (i === pts.length - 1) {
      d += ` L ${curr.x} ${curr.y}`;
    } else {
      const next = pts[i + 1];
      const dxIn  = curr.x - prev.x, dyIn  = curr.y - prev.y;
      const dxOut = next.x - curr.x, dyOut = next.y - curr.y;
      const lenIn  = Math.abs(dxIn)  + Math.abs(dyIn);
      const lenOut = Math.abs(dxOut) + Math.abs(dyOut);
      const r = Math.min(radius, lenIn / 2, lenOut / 2);
      if (r > 0) {
        const ux = dxIn  / lenIn,  uy = dyIn  / lenIn;
        const vx = dxOut / lenOut, vy = dyOut / lenOut;
        d += ` L ${curr.x - r * ux} ${curr.y - r * uy} Q ${curr.x} ${curr.y} ${curr.x + r * vx} ${curr.y + r * vy}`;
      } else {
        d += ` L ${curr.x} ${curr.y}`;
      }
    }
  }
  return d;
}

// ─── Main update ─────────────────────────────────────────────────────────────
window.__updatePlaygroundRelationships = function (entities, dataModel, positions) {
  if (!entities || !dataModel?.relationships || !positions) return;

  const getDOMNode = (id) => document.querySelector(`[data-entity-id="${id}"]`);

  const getFieldY = (id, fieldName) => {
    const card = getDOMNode(id);
    if (!card) return null;
    const row = card.querySelector(`[data-field-name="${fieldName}"]`);
    return row ? row.offsetTop + row.offsetHeight / 2 : card.offsetHeight / 2;
  };

  const cardRects = entities.map(e => {
    const id = e.schema_id || e.schemaId || e.id;
    const pos = positions[id];
    const card = getDOMNode(id);
    if (!pos || !card) return null;
    return { id, left: pos.x, top: pos.y, right: pos.x + card.offsetWidth, bottom: pos.y + card.offsetHeight };
  }).filter(Boolean);

  // ── 0. Compute Canvas Average X (for routing side inference) ──────────────
  const allCenters = entities.map(e => {
    const id = e.schema_id || e.schemaId || e.id;
    const pos = positions[id];
    const card = getDOMNode(id);
    return pos && card ? pos.x + card.offsetWidth / 2 : 0;
  }).filter(x => x > 0);
  const avgCanvasX = allCenters.length > 0 ? allCenters.reduce((a, b) => a + b, 0) / allCenters.length : 800;

  // ── 1. Collect raw path info ───────────────────────────────────────────────
  const raw = [];
  dataModel.relationships.forEach((rel, i) => {
    const se = entities.find(e => norm(e.tableName) === norm(rel.from_table));
    const de = entities.find(e => norm(e.tableName) === norm(rel.to_table));
    if (!se || !de) return;

    const sid = se.schema_id || se.schemaId || se.id;
    const did = de.schema_id || de.schemaId || de.id;
    const sp  = positions[sid], dp = positions[did];
    if (!sp || !dp) return;

    const sc = getDOMNode(sid), dc = getDOMNode(did);
    if (!sc || !dc) return;

    const fromCol = norm(rel.from_column);
    const toCol = norm(rel.to_column);

    const fy1 = getFieldY(sid, fromCol) ?? sc.offsetHeight / 2;
    const fy2 = getFieldY(did, toCol)   ?? dc.offsetHeight / 2;

    const y1 = sp.y + fy1, y2 = dp.y + fy2;
    const sL = sp.x, sR = sp.x + sc.offsetWidth;
    const dL = dp.x, dR = dp.x + dc.offsetWidth;
    const GAP = 30;
    const excludeIds = new Set([sid, did]);

    let x1, x2, startSide, endSide;
    if (sR + GAP < dL) {
      x1 = sR; x2 = dL; startSide = 'right'; endSide = 'left';
    } else if (dR + GAP < sL) {
      x1 = sL; x2 = dR; startSide = 'left'; endSide = 'right';
    } else {
      // Cards are vertically stacked/overlapping horizontally.
      // Route the connection on the "outside" edge relative to the canvas center
      // so it doesn't cross over the main central relationship lines.
      const sCX = sL + sc.offsetWidth / 2;
      if (sCX >= avgCanvasX) {
        x1 = sR; x2 = dR; startSide = 'right'; endSide = 'right';
      } else {
        x1 = sL; x2 = dL; startSide = 'left'; endSide = 'left';
      }
    }

    raw.push({ index: i, srcId: sid, dstId: did, fromCol, toCol, x1, y1, x2, y2, excludeIds, startSide, endSide, stepDownStart: 0, stepDownEnd: 0, baseMidX: 0, corridorOffset: 0 });
  });

  // ── 2. Handle T-Junctions for BOTH start and end points ────────────────────
  // If multiple lines attach to the exact same field (either as source or dest),
  // they share a short 16px stem and then branch vertically.
  const attachments = new Map();

  raw.forEach((rp, idx) => {
    // Determine attachment points.
    const startKey = `${rp.srcId}::${rp.fromCol}::${rp.startSide}`;
    if (!attachments.has(startKey)) attachments.set(startKey, []);
    attachments.get(startKey).push({ pathIndex: idx, type: 'start', yRef: rp.y2 });

    const endKey = `${rp.dstId}::${rp.toCol}::${rp.endSide}`;
    if (!attachments.has(endKey)) attachments.set(endKey, []);
    attachments.get(endKey).push({ pathIndex: idx, type: 'end', yRef: rp.y1 });
  });

  const STEP = 16;
  attachments.forEach((items) => {
    if (items.length <= 1) return;
    
    // Sort items by their destination's Y coordinate to avoid crossing lines at the junction
    items.sort((a, b) => a.yRef - b.yRef);
    
    const half = (items.length - 1) / 2;
    items.forEach((item, lane) => {
      const stepVal = Math.round((lane - half) * STEP);
      if (item.type === 'start') {
        raw[item.pathIndex].stepDownStart = stepVal;
      } else {
        raw[item.pathIndex].stepDownEnd = stepVal;
      }
    });
  });

  // ── 3. Base MidX calculation ──────────────────────────────────────────────
  raw.forEach(rp => {
    const steppedY1 = rp.y1 + rp.stepDownStart;
    const steppedY2 = rp.y2 + rp.stepDownEnd;
    rp.baseMidX = findSafeMidX(rp.x1, steppedY1, rp.x2, steppedY2, cardRects, rp.excludeIds, rp.startSide, rp.endSide);
  });

  // ── 4. Spread overlapping vertical corridors globally ─────────────────────
  // If any two paths want to use the exact same vertical corridor (midX), spread them out.
  const midXGroups = new Map();
  raw.forEach((rp, idx) => {
    const key = Math.round(rp.baseMidX);
    if (!midXGroups.has(key)) midXGroups.set(key, []);
    midXGroups.get(key).push(idx);
  });

  const CORRIDOR = 16;
  midXGroups.forEach(idxs => {
    if (idxs.length <= 1) return;
    
    // Sort by the top-most point of their vertical segment
    idxs.sort((a, b) => {
      const topA = Math.min(raw[a].y1 + raw[a].stepDownStart, raw[a].y2 + raw[a].stepDownEnd);
      const topB = Math.min(raw[b].y1 + raw[b].stepDownStart, raw[b].y2 + raw[b].stepDownEnd);
      return topA - topB;
    });

    const half = (idxs.length - 1) / 2;
    idxs.forEach((rawIdx, lane) => {
      raw[rawIdx].corridorOffset = Math.round((lane - half) * CORRIDOR);
    });
  });

  // ── 5. Build SVG paths ────────────────────────────────────────────────────
  const allPaths = [];
  raw.forEach((rp) => {
    const midX = rp.baseMidX + rp.corridorOffset;
    
    const pts = computeOrthogonalPath(rp.x1, rp.y1, rp.x2, rp.y2, midX, rp.stepDownStart, rp.stepDownEnd, rp.startSide, rp.endSide);
    const { hSegments, vSegments } = buildSegments(pts);
    allPaths.push({ index: rp.index, pts, hSegments, vSegments, jumps: [] });
  });

  // ── 6. Intersection bridge jumps ──────────────────────────────────────────
  for (let i = 0; i < allPaths.length; i++) {
    for (let j = 0; j < allPaths.length; j++) {
      if (i === j) continue;
      for (const h of allPaths[i].hSegments) {
        for (const v of allPaths[j].vSegments) {
          const pt = getIntersection(h, v);
          if (pt) allPaths[i].jumps.push(pt);
        }
      }
    }
  }

  // ── 7. Render ─────────────────────────────────────────────────────────────
  allPaths.forEach(({ index, pts, jumps }) => {
    const el = document.getElementById(`rel-path-${index}`);
    if (el) el.setAttribute('d', generateSVGPath(pts, jumps));
  });
};

function norm(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9_]+/g, '');
}
