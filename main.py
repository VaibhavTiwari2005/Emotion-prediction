
import re
import pickle
import numpy as np

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from keras.models import load_model
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from tensorflow.keras.preprocessing.sequence import pad_sequences


# 1. Constants

model_path = "Artifacts/BiGRU_Model.keras"
tokenizer_path = "Artifacts/tokenizer.pkl"

max_sequence_length = 50

emotion_labels = ['sadness', 'joy', 'love', 'anger', 'fear', 'surprise']

EMOTION_EMOJIS = {
    "sadness": "😢",
    "joy": "😄",
    "love": "❤️",
    "anger": "😠",
    "fear": "😨",
    "surprise": "😲",
}


# 2. Text Preprocessing

def preprocess_text(text: str) -> str:
    text = text.lower()
    text = re.sub(r"'", "", text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


# 3. Request and Response Schemas

class TextInput(BaseModel):
    text: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="The sentence to analyze",
        json_schema_extra={"example": "I feel so happy and excited"}
    )


class PredictionResponse(BaseModel):
    text: str
    predicted_emotion: str
    confidence: float
    all_probabilities: dict[str, float]


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool


# 4. Model Loading and Lifespan Management

dl_model = {}


@asynccontextmanager
async def lifespan(app: FastAPI):

    print("Loading the model and tokenizer...")

    dl_model["BiGRU"] = load_model(model_path)

    with open(tokenizer_path, "rb") as file:
        dl_model["Tokenizer"] = pickle.load(file)

    print("Models loaded successfully!")

    yield

    dl_model.clear()


# 5. FastAPI Application

app = FastAPI(
    lifespan=lifespan
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    "/static",
    StaticFiles(directory="static"),
    name="static"
)


# 6. API Endpoints

# A. Homepage

@app.get("/", include_in_schema=False)
def server_ui():
    return FileResponse("static/index.html")


# B. Health Check

@app.get("/health", response_model=HealthResponse)
def health_check():

    return HealthResponse(
        status="Server is running",
        model_loaded=(
            "BiGRU" in dl_model and "Tokenizer" in dl_model
        )
    )


# C. Emotion Prediction

@app.post("/predict", response_model=PredictionResponse)
def predict_emotion(text_input: TextInput):

    BiGRU_model = dl_model.get("BiGRU")
    tokenizer_model = dl_model.get("Tokenizer")

    if BiGRU_model is None or tokenizer_model is None:
        raise HTTPException(
            status_code=503,
            detail="Model is not loaded yet."
        )

    # 1. Preprocess text

    cleaned_text = preprocess_text(text_input.text)

    # 2. Tokenize text

    tokenized_text = tokenizer_model.texts_to_sequences(
        [cleaned_text]
    )

    # 3. Padding

    padded_sequences = pad_sequences(
        tokenized_text,
        maxlen=max_sequence_length,
        padding="post",
        truncating="post"
    )

    # 4. Prediction

    probabilities = BiGRU_model.predict(
        padded_sequences,
        verbose=0
    )[0]

    # 5. Get highest probability emotion

    top_emotion_index = int(np.argmax(probabilities))

    all_probabilities = {
        label: float(prob)
        for label, prob in zip(emotion_labels, probabilities)
    }

    # 6. Return response

    return PredictionResponse(
        text=text_input.text,
        predicted_emotion=emotion_labels[top_emotion_index],
        confidence=float(probabilities[top_emotion_index]),
        all_probabilities=all_probabilities
    )
