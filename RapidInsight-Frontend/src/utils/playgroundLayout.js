export const PLAYGROUND_CARD_WIDTH = 300;

/*
 * Use a deliberately safe row height.
 *
 * The cards have different numbers of fields, so calculating the next row
 * from one card's estimated height can cause overlap. A fixed row slot keeps
 * every card separated consistently.
 */
export const PLAYGROUND_ROW_HEIGHT = 250;

export const PLAYGROUND_COLUMN_GAP = 80;
export const PLAYGROUND_ROW_GAP = 42;

export const PLAYGROUND_MAX_COLUMNS = 3;

export const PLAYGROUND_TOP_SAFE_AREA = 76;
export const PLAYGROUND_SIDE_PADDING = 28;
export const PLAYGROUND_BOTTOM_PADDING = 28;

function getEntityId(entity) {
  return (
    entity?.schema_id ||
    entity?.schemaId ||
    entity?.id
  );
}

export function buildInitialLayout(
  entities = [],
  containerWidth = 1200,
  containerHeight = 650
) {
  if (!Array.isArray(entities) || entities.length === 0) {
    return {};
  }

  const width = Math.max(
    Number(containerWidth) || 1200,
    PLAYGROUND_CARD_WIDTH +
      PLAYGROUND_SIDE_PADDING * 2
  );

  const height = Math.max(
    Number(containerHeight) || 650,
    320
  );

  const usableWidth =
    width - PLAYGROUND_SIDE_PADDING * 2;

  const columnsThatFit = Math.max(
    1,
    Math.floor(
      (usableWidth + PLAYGROUND_COLUMN_GAP) /
        (
          PLAYGROUND_CARD_WIDTH +
          PLAYGROUND_COLUMN_GAP
        )
    )
  );

  const columnCount = Math.min(
    PLAYGROUND_MAX_COLUMNS,
    columnsThatFit,
    entities.length
  );

  const rowCount = Math.ceil(
    entities.length / columnCount
  );

  /*
   * A row occupies ROW_HEIGHT, and rows are separated by ROW_GAP.
   */
  const gridHeight =
    rowCount * PLAYGROUND_ROW_HEIGHT +
    Math.max(0, rowCount - 1) *
      PLAYGROUND_ROW_GAP;

  const availableVerticalSpace = Math.max(
    0,
    height -
      PLAYGROUND_TOP_SAFE_AREA -
      PLAYGROUND_BOTTOM_PADDING
  );

  const startY =
    PLAYGROUND_TOP_SAFE_AREA +
    Math.max(
      0,
      (availableVerticalSpace - gridHeight) / 2
    );

  return entities.reduce(
    (positions, entity, index) => {
      const id = getEntityId(entity);

      if (!id) {
        return positions;
      }

      const row = Math.floor(index / columnCount);
      const column = index % columnCount;

      /*
       * Independently center each row. This also centers a final incomplete
       * row instead of keeping it left-aligned.
       */
      const rowFirstIndex = row * columnCount;

      const entitiesInRow = Math.min(
        columnCount,
        entities.length - rowFirstIndex
      );

      const rowWidth =
        entitiesInRow * PLAYGROUND_CARD_WIDTH +
        Math.max(0, entitiesInRow - 1) *
          PLAYGROUND_COLUMN_GAP;

      const rowStartX = Math.max(
        PLAYGROUND_SIDE_PADDING,
        (width - rowWidth) / 2
      );

      positions[id] = {
        x:
          rowStartX +
          column *
            (
              PLAYGROUND_CARD_WIDTH +
              PLAYGROUND_COLUMN_GAP
            ),

        y:
          startY +
          row *
            (
              PLAYGROUND_ROW_HEIGHT +
              PLAYGROUND_ROW_GAP
            ) + (column % 2 !== 0 ? PLAYGROUND_ROW_HEIGHT / 2 : 0),
      };

      return positions;
    },
    {}
  );
}

export function buildStarSchemaLayout(entities = [], containerWidth = 1200, containerHeight = 650, dataModel = null) {
  if (!Array.isArray(entities) || entities.length === 0) return {};

  const width = Math.max(Number(containerWidth) || 1200, PLAYGROUND_CARD_WIDTH * 3);
  const height = Math.max(Number(containerHeight) || 650, PLAYGROUND_ROW_HEIGHT * 3);
  const centerX = (width - PLAYGROUND_CARD_WIDTH) / 2;

  const positions = {};

  // Helper to normalize table names for relationship matching (removes schema prefix)
  const normalizeName = (name) => {
    if (!name) return "";
    const parts = String(name).split('.');
    return parts[parts.length - 1].toLowerCase().trim();
  };

  // Step 1: Identify Tables
  let factTables = entities.filter(e => e.tableType && e.tableType.toLowerCase() === 'fact');
  if (factTables.length === 0) {
    factTables = [entities[0]];
  }
  const dimTables = entities.filter(e => !factTables.some(f => getEntityId(f) === getEntityId(e)));

  // Step 3: Map each dimension to a primary fact table based on relationships
  const dimToFactMap = {};
  
  dimTables.forEach(dim => {
    const dimName = normalizeName(dim.tableName);
    let assignedFact = null;

    if (dataModel && dataModel.relationships) {
      for (const rel of dataModel.relationships) {
        const fromName = normalizeName(rel.from_table);
        const toName = normalizeName(rel.to_table);
        
        if (fromName === dimName || toName === dimName) {
          const otherName = fromName === dimName ? toName : fromName;
          const foundFact = factTables.find(f => normalizeName(f.tableName) === otherName);
          if (foundFact) {
            assignedFact = foundFact;
            break; // Assign to the first connected fact table
          }
        }
      }
    }

    if (!assignedFact) {
      assignedFact = factTables[0]; // Default to first fact table if no relationship found
    }

    const factId = getEntityId(assignedFact);
    if (!dimToFactMap[factId]) dimToFactMap[factId] = [];
    dimToFactMap[factId].push(dim);
  });

  // Group dimensions into a single Left column and a single Right column
  const leftDims = [];
  const rightDims = [];

  factTables.forEach((fact, index) => {
    const dims = dimToFactMap[getEntityId(fact)] || [];
    
    if (factTables.length === 1) {
      // Single fact table: split its dimensions evenly
      dims.forEach((dim, i) => {
        if (i % 2 === 0) leftDims.push(dim);
        else rightDims.push(dim);
      });
    } else {
      // Multiple fact tables: Left half goes to left column, right half goes to right column
      if (index < factTables.length / 2) {
        leftDims.push(...dims);
      } else {
        rightDims.push(...dims);
      }
    }
  });

  const hasLeft = leftDims.length > 0;
  const hasRight = rightDims.length > 0;
  
  // Calculate total width
  // Columns: (1 if leftDims) + factTables.length + (1 if rightDims)
  const totalColumns = (hasLeft ? 1 : 0) + factTables.length + (hasRight ? 1 : 0);
  const totalGridWidth = totalColumns * PLAYGROUND_CARD_WIDTH + (totalColumns - 1) * PLAYGROUND_COLUMN_GAP;
  
  let currentX = Math.max(PLAYGROUND_SIDE_PADDING, (width - totalGridWidth) / 2);
  const globalCenterY = PLAYGROUND_TOP_SAFE_AREA + Math.max(0, (height - PLAYGROUND_ROW_HEIGHT) / 2);
  const columnOffset = PLAYGROUND_CARD_WIDTH + PLAYGROUND_COLUMN_GAP;

  const HEADER_HEIGHT = 45;
  const FIELD_HEIGHT = 32;

  const getFieldOffsetY = (entity, fieldName) => {
    const fields = entity.fields || entity.schema_definition?.fields || entity.schemaDefinition?.fields || entity.columns || [];
    const index = fields.findIndex(f => normalizeName(f.name || f.column_name) === normalizeName(fieldName));
    if (index === -1) return HEADER_HEIGHT;
    return HEADER_HEIGHT + index * FIELD_HEIGHT + (FIELD_HEIGHT / 2);
  };

  const layoutVerticalColumn = (dimGroup, xPos) => {
    if (!dimGroup.length) return;

    // 1. Calculate ideal Y for each dimension to perfectly align connected fields
    const dimsWithIdealY = dimGroup.map(dim => {
      let idealY = globalCenterY; // fallback to the fact table spine's Y
      let connectionCount = 0;
      let totalIdealY = 0;
      
      const dimName = normalizeName(dim.tableName);

      if (dataModel && dataModel.relationships) {
        dataModel.relationships.forEach(rel => {
          const fromName = normalizeName(rel.from_table);
          const toName = normalizeName(rel.to_table);
          
          if (fromName === dimName || toName === dimName) {
            const isFrom = fromName === dimName;
            const factName = isFrom ? toName : fromName;
            const fact = factTables.find(f => normalizeName(f.tableName) === factName);
            
            if (fact) {
              const dimFieldName = isFrom ? rel.from_field : rel.to_field;
              const factFieldName = isFrom ? rel.to_field : rel.from_field;
              
              const dimFieldOffset = getFieldOffsetY(dim, dimFieldName);
              const factFieldOffset = getFieldOffsetY(fact, factFieldName);
              
              // Dim_Y + Dim_Field_Offset = Fact_Y + Fact_Field_Offset
              const targetY = globalCenterY + factFieldOffset - dimFieldOffset;
              
              totalIdealY += targetY;
              connectionCount++;
            }
          }
        });
      }

      if (connectionCount > 0) {
        idealY = totalIdealY / connectionCount;
      }
      return { dim, idealY };
    });

    // 2. Sort by ideal Y to maintain topological order
    dimsWithIdealY.sort((a, b) => a.idealY - b.idealY);

    // 3. Collision-free placement using dynamic card heights
    let currentY = -Infinity;
    let prevCardHeight = 0;
    
    // Top-to-bottom packing
    dimsWithIdealY.forEach(item => {
      // Gap required is height of previous card + margin
      const minGap = currentY === -Infinity ? 0 : prevCardHeight + PLAYGROUND_ROW_GAP;
      let y = Math.max(currentY + minGap, item.idealY);
      item.actualY = y;
      currentY = y;
      
      // Calculate dynamic height of this card for the next iteration
      const fields = item.dim.fields || item.dim.schema_definition?.fields || item.dim.schemaDefinition?.fields || item.dim.columns || [];
      const visibleCount = Math.min(fields.length, 7);
      const hasMore = fields.length > 7;
      prevCardHeight = 42 + 8 + visibleCount * 28 + (hasMore ? 28 : 0); // Header + Padding + Rows
    });

    // Final assignment (no average shifting, so cards stay exactly at idealY if possible)
    dimsWithIdealY.forEach(item => {
      positions[getEntityId(item.dim)] = { x: xPos, y: item.actualY };
    });
  };

  // 1. Layout Left Dimensions
  if (hasLeft) {
    layoutVerticalColumn(leftDims, currentX);
    currentX += columnOffset;
  }

  // 2. Position all Fact tables in a horizontal spine
  factTables.forEach(fact => {
    positions[getEntityId(fact)] = { x: currentX, y: globalCenterY };
    currentX += columnOffset;
  });

  // 3. Layout Right Dimensions
  if (hasRight) {
    layoutVerticalColumn(rightDims, currentX);
    currentX += columnOffset; // not strictly necessary for the last column, but keeps currentX accurate
  }

  return positions;
}
