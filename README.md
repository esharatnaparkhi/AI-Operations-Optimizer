# AI Operations Optimizer

LLM Monitor is a lightweight Python SDK for monitoring and optimizing LLM usage in production applications.  
With a single wrapper line, it captures token usage, cost, and latency for OpenAI-compatible calls and sends structured telemetry to a backend where users can analyze performance in a dashboard.

It acts as an observability and optimization layer for LLM systems, similar to how Sentry monitors errors, but focused on LLM efficiency.

---

### *What It Does*

- Wraps OpenAI-compatible clients with one line of code  
- Captures tokens, cost, latency, model usage, and feature tags  
- Ships batched telemetry asynchronously with minimal overhead  
- Enables dashboard-level visibility into cost, usage patterns, and hotspots  
- Supports optimization suggestions and simulation via backend processing  

---

### *How It Works*

1. **Client Instrumentation**  
   The SDK wraps an OpenAI-compatible client using a lightweight proxy. It intercepts each request/response cycle without modifying your application logic or changing model behavior.

2. **Metadata Collection**  
   For every LLM call, the SDK captures structured telemetry:
   - Prompt and completion token usage  
   - Model name and endpoint type  
   - End-to-end latency  
   - Optional feature tags for grouping  
   - Error status (if any)  

   This data is derived from response usage fields and timing measurements.

3. **Batched Event Shipping**  
   Collected events are buffered in memory and sent asynchronously in batches to the backend ingestion API.  
   This minimizes runtime overhead and prevents blocking application requests.

4. **Backend Processing**  
   The backend:
   - Computes cost deterministically using model pricing tables  
   - Aggregates metrics by project, model, and feature  
   - Detects abnormal cost or latency patterns  
   - Generates optimization suggestions (e.g., model swaps, prompt reduction)

5. **Dashboard Insights**  
   Processed metrics are surfaced in a dashboard where users can:
   - Analyze token and cost distribution  
   - Identify inefficient prompts (hotspots)  
   - Simulate potential savings before applying optimizations  

Integration requires only wrapping the client, no changes to core application logic.

---

### *Syntax*

```python
import openai
from llm_monitor import LLMMonitor

monitor = LLMMonitor(api_key="your-project-key")
client = monitor.wrap_openai(openai.OpenAI())

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
    extra_headers={"X-Feature-Tag": "chat"}
)
