// Package ai — расширение графа через DeepSeek (аналог app/ai).
package ai

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Hub рассылает события всем подключённым редакторам.
type Hub struct {
	mu    sync.Mutex
	conns map[*Client]struct{}
}

type Client struct {
	conn *websocket.Conn
	wmu  sync.Mutex // gorilla/websocket не допускает параллельной записи
}

func NewHub() *Hub { return &Hub{conns: map[*Client]struct{}{}} }

func (h *Hub) Register(conn *websocket.Conn) *Client {
	c := &Client{conn: conn}
	h.mu.Lock()
	h.conns[c] = struct{}{}
	h.mu.Unlock()
	return c
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	delete(h.conns, c)
	h.mu.Unlock()
}

// Broadcast отправляет JSON всем клиентам; «мёртвые» соединения удаляются.
func (h *Hub) Broadcast(msg any) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(msg); err != nil {
		slog.Error("ws: marshal", "err", err)
		return
	}
	payload := bytes.TrimRight(buf.Bytes(), "\n")

	h.mu.Lock()
	targets := make([]*Client, 0, len(h.conns))
	for c := range h.conns {
		targets = append(targets, c)
	}
	h.mu.Unlock()

	for _, c := range targets {
		c.wmu.Lock()
		_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		err := c.conn.WriteMessage(websocket.TextMessage, payload)
		c.wmu.Unlock()
		if err != nil {
			h.Unregister(c)
			_ = c.conn.Close()
		}
	}
}

// KeepAlive читает входящие сообщения до разрыва соединения.
func (c *Client) KeepAlive() {
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

// CloseAll закрывает все соединения (при остановке сервера).
func (h *Hub) CloseAll() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.conns {
		_ = c.conn.Close()
		delete(h.conns, c)
	}
}
