import shutil
import tempfile

from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from agent.agent import app as agent_app

app = FastAPI()
# local development: the Next.js dev server calls this API straight from the browser
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["POST"])


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/analyze")
def analyze(file: UploadFile):
    """Run the agent on an uploaded CoA PDF and return the report's json-render UI spec."""
    # a plain `def`: FastAPI runs it in a worker thread, so the minutes-long agent run doesn't block the server
    with tempfile.NamedTemporaryFile(suffix=".pdf") as pdf:
        shutil.copyfileobj(file.file, pdf)
        pdf.flush()
        return agent_app.invoke({"document_path": pdf.name})["ui_spec"]
