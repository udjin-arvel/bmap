package db

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

// NowISO — время в формате Python datetime.now(timezone.utc).isoformat().
func NowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000000-07:00")
}

// OpenSQLite открывает (и при необходимости создаёт) базу и таблицы.
func OpenSQLite(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	conn, err := sql.Open("sqlite3", path+"?_busy_timeout=5000&_foreign_keys=on")
	if err != nil {
		return nil, err
	}
	// SQLite плохо переносит параллельную запись — одно соединение, как в aiosqlite.
	conn.SetMaxOpenConns(1)
	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, err
	}

	stmts := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
			created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS applied_seeds (
			seed_id TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL
		)`,
	}
	for _, s := range stmts {
		if _, err := conn.Exec(s); err != nil {
			conn.Close()
			return nil, err
		}
	}
	return &Store{Conn: conn}, nil
}

func (s *Store) Close() error {
	if s == nil || s.Conn == nil {
		return nil
	}
	return s.Conn.Close()
}

// bcrypt учитывает только первые 72 байта. Python-библиотека bcrypt 4.x молча обрезает
// пароль, а Go возвращает ErrPasswordTooLong — обрезаем сами, чтобы хэши были совместимы.
func bcryptInput(plain string) []byte {
	b := []byte(plain)
	if len(b) > 72 {
		b = b[:72]
	}
	return b
}

func HashPassword(plain string) (string, error) {
	h, err := bcrypt.GenerateFromPassword(bcryptInput(plain), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(h), nil
}

func VerifyPassword(plain, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), bcryptInput(plain)) == nil
}

func (s *Store) CountUsers() (int, error) {
	var c int
	err := s.Conn.QueryRow("SELECT COUNT(*) FROM users").Scan(&c)
	return c, err
}

// SeedUsers создаёт пользователя viewer, если таблица пуста.
func (s *Store) SeedUsers(viewerPassword string) error {
	c, err := s.CountUsers()
	if err != nil || c > 0 {
		return err
	}
	return s.CreateUser("viewer", viewerPassword, "viewer")
}

func (s *Store) CreateUser(username, plainPassword, role string) error {
	hash, err := HashPassword(plainPassword)
	if err != nil {
		return err
	}
	_, err = s.Conn.Exec(
		"INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
		username, hash, role, NowISO(),
	)
	return err
}

// GetUserByUsername возвращает nil, nil, если пользователь не найден.
func (s *Store) GetUserByUsername(username string) (*User, error) {
	var u User
	err := s.Conn.QueryRow(
		"SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?",
		username,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Store) UpdateUserRole(username, role string) error {
	_, err := s.Conn.Exec("UPDATE users SET role = ? WHERE username = ?", role, username)
	return err
}

func (s *Store) Ping() bool {
	var one int
	return s.Conn.QueryRow("SELECT 1").Scan(&one) == nil
}

func (s *Store) IsSeedApplied(seedID string) (bool, error) {
	var one int
	err := s.Conn.QueryRow("SELECT 1 FROM applied_seeds WHERE seed_id = ?", seedID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (s *Store) MarkSeedApplied(seedID string) error {
	_, err := s.Conn.Exec(
		"INSERT OR IGNORE INTO applied_seeds (seed_id, applied_at) VALUES (?, ?)",
		seedID, NowISO(),
	)
	return err
}
