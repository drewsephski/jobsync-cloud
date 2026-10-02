export function mcpClientConfigs(origin: string, token = "<YOUR_TOKEN>") {
  const url = `${origin}/api/mcp`
  return {
    url,
    codex: `[mcp_servers.jobsync]\nurl = ${JSON.stringify(url)}\nbearer_token_env_var = "JOBSYNC_MCP_TOKEN"`,
    remote: JSON.stringify(
      {
        mcpServers: {
          jobsync: {
            type: "http",
            url,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      },
      null,
      2
    ),
    claude: JSON.stringify(
      {
        mcpServers: {
          jobsync: {
            command: "npx",
            args: [
              "-y",
              "mcp-remote",
              url,
              "--header",
              `Authorization: Bearer ${token}`,
            ],
          },
        },
      },
      null,
      2
    ),
  }
}
