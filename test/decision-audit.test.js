import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDecisionReport } from '../scripts/decision-audit.js';
test('operational audit flags inexecutable actions, shared cuts and overspent plans', () => {
  const report={ byPosition:{DEF:[{sleeperId:'BUF',availability:{canStartTargetWeek:false,canAddNow:false},waiver:{decision:{recommendedAction:'ADD_NOW'},fit:{legalTransaction:true,horizonCovered:true}}}]},acquisitionPlan:{initialFaab:10,steps:[{suggestedBid:7,dropCandidate:{sleeperId:'cut'}},{suggestedBid:7,dropCandidate:{sleeperId:'cut'}}]} };
  const audit=auditDecisionReport(report);
  assert.equal(audit.operationalValidityRate,0);
  assert.deepEqual(audit.planIssues,['DUPLICATE_CUT','BUDGET_EXCEEDED_OR_UNKNOWN']);
  assert.equal(audit.fantasyPerformanceEvaluated,false);
  assert.equal(auditDecisionReport({byPosition:{}}).operationalValidityRate,null);
});
