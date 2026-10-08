import json
import shutil
import tempfile
from time import perf_counter

from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from agent.agent import app as agent_app

app = FastAPI()
# local development: the Next.js dev server calls this API straight from the browser
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["POST"])


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/analyze")
def analyze(file: UploadFile):
    """Run the agent on an uploaded CoA PDF, streaming one JSON line per event.

    Lines: {"start": <node>} when a step begins, {"output": <one line>, "node": <node>} when the step reports what it
    produced, {"step": <node>, "ms": <duration>} when it finishes, then {"done": <json-render UI spec>} or
    {"error": <message>}.
    """
    pdf = tempfile.NamedTemporaryFile(suffix=".pdf")
    shutil.copyfileobj(file.file, pdf)
    pdf.flush()

    # a plain generator: Starlette iterates it in a worker thread, so the minutes-long agent run doesn't block the server
    def events():
        # the graph runs one step at a time, so the last started step is the one that is running and is being timed
        running, started = None, 0.0
        try:
            for mode, data in agent_app.stream({"document_path": pdf.name}, stream_mode=["tasks", "custom"]):
                if mode == "custom":  # a node reported its output with its stream writer
                    yield json.dumps({"output": data, "node": running}) + "\n"
                elif "input" in data:  # a task is about to run
                    running, started = data["name"], perf_counter()
                    yield json.dumps({"start": running}) + "\n"
                elif data["error"]:
                    yield json.dumps({"error": data["error"]}) + "\n"
                    return
                else:  # a task finished
                    yield json.dumps({"step": data["name"], "ms": round((perf_counter() - started) * 1000)}) + "\n"
                    if "ui_spec" in (data["result"] or {}):
                        yield json.dumps({"done": data["result"]["ui_spec"]}) + "\n"
        except Exception as error:
            yield json.dumps({"error": str(error) or type(error).__name__}) + "\n"
        finally:
            pdf.close()  # removes the temp file

    return StreamingResponse(events(), media_type="application/x-ndjson")
