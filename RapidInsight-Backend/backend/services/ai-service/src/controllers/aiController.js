const {
  generateBlueprint
} = require('../services/blueprintService');

const {
  generateRelationships
} = require('../services/relationshipService');

const {
  generateKpiPlan
} = require('../services/kpiPlanService');

const {
  generateSqlKpiQueries,
  repairSqlKpiQuery
} = require('../services/sqlKpiService');

const {
  generateDashboardSpec
} = require('../services/dashboardSpecService');

const {
  generateInsights
} = require('../services/insightService');

const {
  generateSeedRows
} = require('../services/seedRowService');

async function seedRows(req, res, next) {
  try {
    const result = await generateSeedRows({
      ...(req.body || {}),
      requestedBy: {
        id: req.user.id,
        email: req.user.email
      }
    });

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

async function writeInsights(req, res, next) {
  try {
    const insights = await generateInsights({
      ...(req.body || {}),
      requestedBy: {
        id: req.user.id,
        email: req.user.email
      }
    });

    return res.json({
      success: true,
      data: insights
    });
  } catch (error) {
    next(error);
  }
}

async function buildDashboardSpec(req, res, next) {
  try {
    const spec = await generateDashboardSpec({
      ...(req.body || {}),
      requestedBy: {
        id: req.user.id,
        email: req.user.email
      }
    });

    return res.json({
      success: true,
      data: spec
    });
  } catch (error) {
    next(error);
  }
}

async function planKpis(req, res, next) {
  try {
    const plan = await generateKpiPlan({
      ...(req.body || {}),
      requestedBy: {
        id: req.user.id,
        email: req.user.email
      }
    });

    return res.json({
      success: true,
      data: plan
    });
  } catch (error) {
    next(error);
  }
}

// Experimental: step 3 alternative that asks the model to write SQL directly
// instead of a structured plan. See planKpis for the production path.
async function planSqlKpis(req, res, next) {
  try {
    const result = await generateSqlKpiQueries({
      ...(req.body || {}),
      requestedBy: {
        id: req.user.id,
        email: req.user.email
      }
    });

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

async function repairSqlKpi(req, res, next) {
  try {
    const result = await repairSqlKpiQuery({
      ...(req.body || {}),
      requestedBy: {
        id: req.user.id,
        email: req.user.email
      }
    });

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

async function inferRelationships(req, res, next) {
  try {
    const relationships = await generateRelationships({
      ...(req.body || {}),
      requestedBy: {
        id: req.user.id,
        email: req.user.email
      }
    });

    return res.json({
      success: true,
      data: relationships
    });
  } catch (error) {
    next(error);
  }
}

async function generateDataModelBlueprint(req, res, next) {
  try {
    const blueprint = await generateBlueprint({
      ...(req.body || {}),
      requestedBy: {
        id: req.user.id,
        email: req.user.email
      }
    });

    return res.json({
      success: true,
      data: blueprint
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  generateDataModelBlueprint,
  inferRelationships,
  planKpis,
  planSqlKpis,
  repairSqlKpi,
  buildDashboardSpec,
  writeInsights,
  seedRows
};
