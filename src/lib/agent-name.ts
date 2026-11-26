/**
 * «حساب وكيل» 🤖 (`OrganizationMember.agent`, ask 6 of the owner's tasks prompt, 2026-11-25). The label lives IN the name, so it
 * is there wherever a name is shown: a message, a comment, a task's person, a notification, the phone app. Every place that
 * writes an agent's name passes it through `agentName`: once, at the end, whatever was typed.
 */
export const AGENT_MARK = "🤖";

/** The name without the mark, wherever it was typed. */
export const bareAgentName = (name: string): string => name.split(AGENT_MARK).join(" ").replace(/\s+/g, " ").trim();

export const agentName = (name: string): string => `${bareAgentName(name)} ${AGENT_MARK}`;
