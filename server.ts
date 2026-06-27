import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// OpenAI API Setup
let openaiClient: OpenAI | null = null;
function getAiClient() {
  if (!openaiClient) {
    const apiKey = process.env.JENTLY;
    if (!apiKey) {
      console.error("[Server] JENTLY key is missing!");
      throw new Error("JENTLY is not defined");
    }
    openaiClient = new OpenAI({
      apiKey,
      baseURL: "https://api.thisilabs.com/v1",
    });
    console.log("[Server] OpenAI-compatible client initialized.");
  }
  return openaiClient;
}

/**
 * Recursively converts schema types to lowercase (e.g., STRING -> string)
 * as required by OpenAI-compatible JSON schema validation.
 */
function fixSchemaTypes(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(fixSchemaTypes);

  const fixed: any = { ...schema };
  if (typeof fixed.type === 'string') {
    fixed.type = fixed.type.toLowerCase();
    
    if (fixed.type === 'object') {
      fixed.additionalProperties = false;
      if (fixed.properties && !fixed.required) {
        fixed.required = Object.keys(fixed.properties);
      }
    }
  }
  
  if (fixed.properties) {
    for (const key in fixed.properties) {
      fixed.properties[key] = fixSchemaTypes(fixed.properties[key]);
    }
  }

  if (fixed.items) {
    fixed.items = fixSchemaTypes(fixed.items);
  }

  return fixed;
}

/**
 * OpenAI Chat Completion helper
 */
async function generateContent(prompt: string, schema: any, temperature: number = 0.2) {
  const client = getAiClient();
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a helpful assistant that always responds in JSON format based on the provided schema." },
      { role: "user", content: prompt }
    ],
    temperature,
    response_format: { 
      type: "json_schema",
      json_schema: {
        name: "response",
        strict: true,
        schema: fixSchemaTypes(schema)
      }
    }
  });

  return {
    text: response.choices[0].message.content || "{}"
  };
}

// API Routes
app.get("/api/health", (req, res) => {
  console.log("[Server] Health check requested");
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Generic retry wrapper with exponential backoff for Gemini calls
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 4, initialDelay = 2000): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const status = error.status || error.statusCode;
      const isQuotaError = 
        status === 429 ||
        error.message?.toLowerCase().includes("quota") ||
        error.message?.toLowerCase().includes("rate limit") ||
        error.message?.toLowerCase().includes("429");

      const isTransientError = 
        isQuotaError ||
        (status >= 500 && status <= 599) ||
        error.message?.toLowerCase().includes("timeout") ||
        error.message?.toLowerCase().includes("connect") ||
        error.message?.toLowerCase().includes("failed to fetch") ||
        error.message?.toLowerCase().includes("network") ||
        error.message?.toLowerCase().includes("econnreset");

      if (isTransientError && i < maxRetries - 1) {
        let delay = isQuotaError 
          ? (initialDelay * 1.5 * Math.pow(2, i) + Math.random() * 1000)
          : (initialDelay * Math.pow(1.5, i) + Math.random() * 500);
        
        console.warn(`[Server] Transient/Quota error caught (status ${status || 'unknown'}, msg: "${error.message}"). Retrying in ${Math.round(delay/1000)}s... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

app.post("/api/openai/generate-tp", async (req, res) => {
  console.log("[Server] Generating TP...");
  try {
    const { prompt, schema } = req.body;
    const response = await withRetry(() => generateContent(prompt, schema, 0.1));
    res.json({ text: response.text });
  } catch (error: any) {
    console.error("OpenAI Error (TP):", error);
    let status = error.status || 500;
    let message = error.message || "Terjadi kesalahan internal.";
    
    if (status === 401) {
      message = "API Key tidak valid. Silakan periksa key JENTLY di menu Secrets.";
    }
    res.status(status).json({ error: message });
  }
});

app.post("/api/openai/generate-materials", async (req, res) => {
  console.log("[Server] Generating Materials...");
  try {
    const { prompt, schema } = req.body;
    const response = await withRetry(() => generateContent(prompt, schema, 0.2));
    res.json({ text: response.text });
  } catch (error: any) {
    console.error("OpenAI Error (Materials):", error);
    let status = error.status || 500;
    let message = error.message || "Terjadi kesalahan internal.";
    
    if (status === 401) {
      message = "API Key tidak valid. Silakan periksa key JENTLY di menu Secrets.";
    }
    res.status(status).json({ error: message });
  }
});

app.post("/api/openai/generate-modul", async (req, res) => {
  console.log("[Server] Generating Modul Ajar...");
  try {
    const { prompt, schema } = req.body;
    const response = await withRetry(() => generateContent(prompt, schema, 0.3));
    res.json({ text: response.text });
  } catch (error: any) {
    console.error("OpenAI Error (Modul):", error);
    let status = error.status || 500;
    let message = error.message || "Terjadi kesalahan internal.";
    
    if (status === 401) {
      message = "API Key tidak valid. Silakan periksa key JENTLY di menu Secrets.";
    }
    res.status(status).json({ error: message });
  }
});

app.post("/api/openai/generate-atp", async (req, res) => {
  const requestId = Math.random().toString(36).substring(7);
  console.log(`[Server][${requestId}] ATP Request received.`);
  try {
    const { prompt, schema } = req.body;
    if (!prompt) throw new Error("Prompt is required");
    
    const response = await withRetry(() => generateContent(prompt, schema, 0.2));
    res.json({ text: response.text });
  } catch (error: any) {
    console.error(`[Server][${requestId}] OpenAI Error (ATP):`, error);
    let status = error.status || 500;
    let message = error.message || "Terjadi kesalahan internal saat menyusun ATP.";
    
    if (status === 401) {
      message = "API Key tidak valid. Silakan periksa key JENTLY di menu Secrets.";
    }
    res.status(status).json({ error: message });
  }
});

app.post("/api/openai/generate-kelengkapan", async (req, res) => {
  console.log("[Server] Generating Kelengkapan Modul...");
  try {
    const { prompt, schema } = req.body;
    const response = await withRetry(() => generateContent(prompt, schema, 0.3));
    res.json({ text: response.text });
  } catch (error: any) {
    console.error("OpenAI Error (Kelengkapan):", error);
    let status = error.status || 500;
    let message = error.message || "Terjadi kesalahan internal.";
    if (status === 401) {
      message = "API Key tidak valid. Silakan periksa key JENTLY di menu Secrets.";
    }
    res.status(status).json({ error: message });
  }
});

app.post("/api/openai/generate-simple", async (req, res) => {
  console.log("[Server] Generating Simple Content...");
  try {
    const { prompt, schema } = req.body;
    const response = await withRetry(() => generateContent(prompt, schema, 0.3));
    res.json({ text: response.text });
  } catch (error: any) {
    console.error("OpenAI Error (Simple):", error);
    let status = error.status || 500;
    let message = error.message || "Terjadi kesalahan internal.";
    if (status === 401) {
      message = "API Key tidak valid. Silakan periksa key JENTLY di menu Secrets.";
    }
    res.status(status).json({ error: message });
  }
});

// Vite Middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Core API and Vite middleware attached.`);
    console.log(`[Server] Listening on port ${PORT}`);
    console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[Server] OpenAI API Key present: ${!!process.env.JENTLY}`);
  });
  
  // Set a longer timeout (5 minutes) for the server to handle slow AI generations
  server.timeout = 300000;
  server.keepAliveTimeout = 300000;
}

startServer().catch(err => {
  console.error("[Server] Fatal error during startup:", err);
  process.exit(1);
});
