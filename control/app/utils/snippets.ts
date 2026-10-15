export interface Snippet {
  label: string;
  code: string;
}

/** MCP config for a handler key: Gemini CLI settings and the Claude Code command. */
export function mcpSnippets(hqUrl: string, key: string): Snippet[] {
  const gemini = {
    mcpServers: {
      sideagent: { httpUrl: `${hqUrl}/mcp`, headers: { Authorization: `Bearer ${key}` } },
    },
  };
  return [
    { label: "Gemini CLI (.gemini/settings.json)", code: JSON.stringify(gemini, null, 2) },
    {
      label: "Claude Code",
      code: `claude mcp add --transport http sideagent ${hqUrl}/mcp --header "Authorization: Bearer ${key}"`,
    },
  ];
}

/** The field CLI command for a field agent key. */
export function fieldSnippet(hqUrl: string, key: string): Snippet {
  return {
    label: "Laptop field agent (Gemma on Ollama)",
    code: `SIDEAGENT_HQ_URL=${hqUrl} SIDEAGENT_API_KEY=${key} pnpm field`,
  };
}
