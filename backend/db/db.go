package db

import "database/sql"

// Store — обёртка над подключением SQLite (пользователи и применённые сиды).
type Store struct {
	Conn *sql.DB
}

// User — строка таблицы users.
type User struct {
	ID           int64
	Username     string
	PasswordHash string
	Role         string
	CreatedAt    string
}
