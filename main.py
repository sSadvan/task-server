from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from pydantic import BaseModel
import asyncio

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class Task(BaseModel):
    text: str
    delay: int

@app.post("/task")
async def create_task(task: Task):
    print(f"📥 Задача получена: {task.text} через {task.delay} сек")
    await asyncio.sleep(task.delay)
    print(f"📤 Время пришло: {task.text}")
    return {"status": "ok", "text": task.text}

@app.post("/audio")
async def upload_audio(file: UploadFile = File(...)):
    print(f"🎙️ Получен голосовой файл: {file.filename}")
    content = await file.read()

    # Заглушка — эмуляция обработки
    return {
        "text": "напомни улыбнуться",
        "delay": 10
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)