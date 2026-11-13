package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const systemPrompt = "Ты помощник редактора карты рынка. Отвечай только валидным JSON без markdown.\n" +
	"Формат: {\"steps\": [{\"name\": \"...\", \"nodeType\": \"PROCESS|ACTOR|RESOURCE|LOGISTICS\", " +
	"\"description\": \"...\", \"color\": \"#hex или null\", \"anchor\": false}]}\n" +
	"Ровно один шаг с \"anchor\": true — это выбранный пользователем узел (его name совпадает с якорем).\n" +
	"steps — один линейный производственный цикл вокруг якоря: шаги до якоря (upstream), якорь, шаги после (downstream).\n" +
	"От 3 до 16 шагов включительно. Цвет только из палитры: " +
	"#4A90D9, #E67E22, #27AE60, #8E44AD, #C0392B, #7F8C8D или null.\n" +
	"Связи между шагами линейные NEXT_STEP слева направо по порядку массива steps."

type DeepSeek struct {
	APIKey  string
	BaseURL string
	Model   string
	HTTP    *http.Client
}

func NewDeepSeek(apiKey, baseURL, model string) *DeepSeek {
	return &DeepSeek{APIKey: apiKey, BaseURL: baseURL, Model: model, HTTP: &http.Client{Timeout: 120 * time.Second}}
}

// GenerateExpandSteps возвращает content ответа модели (строка с JSON).
func (d *DeepSeek) GenerateExpandSteps(ctx context.Context, anchorName, anchorType string) ([]byte, error) {
	if strings.TrimSpace(d.APIKey) == "" {
		return nil, errors.New("DEEPSEEK_API_KEY is not configured")
	}
	userMsg := fmt.Sprintf("Построй производственный цикл вокруг узла «%s» (тип %s). Верни JSON с полем steps.", anchorName, anchorType)

	body, _ := json.Marshal(map[string]any{
		"model": d.Model,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userMsg},
		},
		"response_format": map[string]string{"type": "json_object"},
		"temperature":     0.4,
	})
	url := strings.TrimRight(d.BaseURL, "/") + "/v1/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+d.APIKey)
	req.Header.Set("Content-Type", "application/json")

	res, err := d.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 400 {
		return nil, fmt.Errorf("DeepSeek error '%s' for url '%s'", res.Status, url)
	}

	var data struct {
		Choices []struct {
			Message struct {
				Content any `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}
	if len(data.Choices) == 0 {
		return nil, errors.New("Unexpected DeepSeek response shape")
	}
	content, ok := data.Choices[0].Message.Content.(string)
	if !ok {
		return nil, errors.New("Unexpected DeepSeek response shape")
	}
	return []byte(content), nil
}
