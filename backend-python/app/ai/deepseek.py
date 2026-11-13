from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from app.config import get_settings


def _system_prompt() -> str:
    return (
        "Ты помощник редактора карты рынка. Отвечай только валидным JSON без markdown.\n"
        "Формат: {\"steps\": [{\"name\": \"...\", \"nodeType\": \"PROCESS|ACTOR|RESOURCE|LOGISTICS\", "
        "\"description\": \"...\", \"color\": \"#hex или null\", \"anchor\": false}]}\n"
        "Ровно один шаг с \"anchor\": true — это выбранный пользователем узел (его name совпадает с якорем).\n"
        "steps — один линейный производственный цикл вокруг якоря: шаги до якоря (upstream), якорь, шаги после (downstream).\n"
        "От 3 до 16 шагов включительно. Цвет только из палитры: "
        "#4A90D9, #E67E22, #27AE60, #8E44AD, #C0392B, #7F8C8D или null.\n"
        "Связи между шагами линейные NEXT_STEP слева направо по порядку массива steps."
    )


async def generate_expand_steps(anchor_name: str, anchor_type: str) -> dict[str, Any]:
    settings = get_settings()
    if not settings.deepseek_api_key.strip():
        raise RuntimeError("DEEPSEEK_API_KEY is not configured")

    user_msg = (
        f"Построй производственный цикл вокруг узла «{anchor_name}» (тип {anchor_type}). "
        "Верни JSON с полем steps."
    )

    url = f"{settings.deepseek_base_url.rstrip('/')}/v1/chat/completions"
    payload = {
        "model": settings.deepseek_model,
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": user_msg},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.4,
    }
    headers = {
        "Authorization": f"Bearer {settings.deepseek_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        res = await client.post(url, json=payload, headers=headers)
        res.raise_for_status()
        data = res.json()

    content = data["choices"][0]["message"]["content"]
    if isinstance(content, str):
        return json.loads(content)
    raise RuntimeError("Unexpected DeepSeek response shape")
