/**
 * project-workflow skill executor — structured project missions from conversation.
 */

import {
  healthCheckProject,
  healthCheckProjectRef,
  projectWorkflowStatus,
  proposeProjectPlan,
  applyProjectPlan,
  updateProjectTaskStatus,
  logProjectProgress,
  resolveProjectRef,
  lookupProjectRef,
  listConfiguredProjects,
  proposeProjectSetup,
  applyProjectSetup,
  updateProjectDetails,
} from '../project-workflow.js';

function parseResult(obj) {
  return JSON.stringify(obj, null, 2);
}

/**
 * @param {object} ctx - agent context (agentId, jid, …)
 * @param {object} args - LLM tool args
 */
export async function executeProjectWorkflow(ctx, args) {
  const action = String(args?.action || args?.command || '').trim().toLowerCase();
  if (!action) {
    return parseResult({
      error: 'action required: list_projects, health_check, propose_setup, apply_setup, update_project, status, propose_plan, apply_plan, update_task, log_progress',
    });
  }

  const agentId = ctx?.agentId || 'main';

  if (action === 'list_projects') {
    return parseResult({ ok: true, projects: listConfiguredProjects() });
  }

  if (action === 'health_check') {
    const ref = args.project || args.projectId || args.projectName;
    const result = healthCheckProjectRef(ref, { userText: args.userText || '' });
    if (result.lookup?.status === 'found' && result.project?.id && ctx) {
      ctx._activeProjectId = Number(result.project.id);
    }
    return parseResult(result);
  }

  if (action === 'propose_setup') {
    return parseResult(proposeProjectSetup(args));
  }

  if (action === 'apply_setup') {
    const result = applyProjectSetup({
      ...args,
      userApproved: args.userApproved === true || args.userApproved === 'true',
    });
    if (result.ok && result.project?.id && ctx) ctx._activeProjectId = Number(result.project.id);
    return parseResult(result);
  }

  if (action === 'update_project') {
    const result = updateProjectDetails({ ...args, userText: args.userText || '' });
    if (result.ok && result.project?.id && ctx) ctx._activeProjectId = Number(result.project.id);
    return parseResult(result);
  }

  if (action === 'status') {
    const ref = args.project || args.projectId || args.projectName;
    if (ref && !resolveProjectRef(ref)) {
      return parseResult({
        ok: false,
        ...lookupProjectRef(ref, { userText: args.userText || '' }),
      });
    }
    const status = projectWorkflowStatus({
      project: ref,
      goalId: args.goalId,
      userText: args.userText || '',
      agentId,
    });
    if (status.project?.id && ctx) ctx._activeProjectId = status.project.id;
    if (status.goal?.id && ctx) ctx._activeGoalId = status.goal.id;
    return parseResult(status);
  }

  if (action === 'propose_plan') {
    const result = proposeProjectPlan({
      ...args,
      ownerAgentId: args.ownerAgentId || agentId,
    });
    if (result.ok && result.project?.id && ctx) ctx._activeProjectId = result.project.id;
    return parseResult(result);
  }

  if (action === 'apply_plan') {
    const result = applyProjectPlan({
      ...args,
      ownerAgentId: args.ownerAgentId || agentId,
      userApproved: args.userApproved === true || args.userApproved === 'true',
    });
    if (result.ok && result.goal?.id && ctx) ctx._activeGoalId = result.goal.id;
    if (result.ok && result.project?.id && ctx) ctx._activeProjectId = result.project.id;
    return parseResult(result);
  }

  if (action === 'update_task') {
    return parseResult(updateProjectTaskStatus(args));
  }

  if (action === 'log_progress') {
    const result = logProjectProgress(args);
    return parseResult(result);
  }

  return parseResult({ error: `Unknown action: ${action}` });
}
