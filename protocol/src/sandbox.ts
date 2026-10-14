/**
 * Isolation flags for the python-sandbox image, shared by HQ checks and laptop runners
 * (technical.md, "Test sandbox"). No `-e`: no host env.
 */
export const DOCKER_RUN_FLAGS = [
  "--rm",
  "--pull=never",
  "--network=none",
  "--read-only",
  "--tmpfs=/tmp:size=64m",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
  "--user=10001",
  "--pids-limit=128",
  "--memory=512m",
  "--cpus=1",
  "--init",
] as const;
