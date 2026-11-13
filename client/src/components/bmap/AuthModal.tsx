import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEMO_SERVER, getServer, setServer } from "@/lib/bmap/api";
import { ApiError, errorMessage } from "@/lib/bmap/errors";
import { DEMO_EDITOR_KEY } from "@/lib/bmap/mock-backend";
import { useEditor } from "@/lib/bmap/store";
import { cn } from "@/lib/utils";

type AuthMode = "login" | "register";

export function AuthModal() {
  const open = useEditor((s) => s.authOpen);
  const { set, login, register, logout } = useEditor.getState();

  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [editorKey, setEditorKey] = useState("");
  const [server, setServerDraft] = useState(DEMO_SERVER);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("login");
      setServerDraft(getServer());
      setError(null);
      setPassword("");
      setPasswordConfirm("");
      setEditorKey("");
    }
  }, [open]);

  const demo = server === DEMO_SERVER;
  const isRegister = mode === "register";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isRegister && password !== passwordConfirm) {
        setError("Пароли не совпадают");
        return;
      }
      if (server !== getServer()) {
        await logout();
        setServer(server);
      }
      if (isRegister) {
        await register(username.trim(), password);
      } else {
        await login(username.trim(), password, editorKey.trim() || undefined);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Неверный логин или пароль");
      } else if (err instanceof ApiError && err.code === "USERNAME_TAKEN") {
        setError(errorMessage(err));
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => set({ authOpen: o })}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-sm">
        <form
          onSubmit={submit}
          className="bmap-scroll max-h-[calc(100dvh-2rem)] space-y-4 overflow-y-auto px-6 py-6"
        >
          <DialogHeader className="pr-6">
            <DialogTitle className="font-display">
              {isRegister ? "Регистрация в BMap" : "Вход в BMap"}
            </DialogTitle>
            <DialogDescription>
              {isRegister
                ? "Новый аккаунт создаётся с ролью просмотра. Редактирование — через ключ при входе."
                : "Ключ редактора открывает режим редактирования и запоминается для вашей учётной записи."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-1.5 rounded-lg border bg-muted/50 p-1">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
              }}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium",
                !isRegister ? "bg-card shadow-sm" : "text-muted-foreground",
              )}
            >
              Вход
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("register");
                setError(null);
                setEditorKey("");
              }}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium",
                isRegister ? "bg-card shadow-sm" : "text-muted-foreground",
              )}
            >
              Регистрация
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="au-user">Логин</Label>
            <Input
              id="au-user"
              autoComplete="username"
              required
              minLength={1}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="au-pass">Пароль</Label>
            <Input
              id="au-pass"
              type="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
              minLength={isRegister ? 4 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {isRegister && (
            <div className="space-y-1.5">
              <Label htmlFor="au-pass2">Повтор пароля</Label>
              <Input
                id="au-pass2"
                type="password"
                autoComplete="new-password"
                required
                minLength={4}
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
              />
            </div>
          )}
          {!isRegister && (
            <div className="space-y-1.5">
              <Label htmlFor="au-key">
                Ключ редактора <span className="font-normal text-muted-foreground">— необязательно</span>
              </Label>
              <Input
                id="au-key"
                type="password"
                autoComplete="off"
                value={editorKey}
                onChange={(e) => setEditorKey(e.target.value)}
              />
            </div>
          )}

          <details className="group rounded-lg border bg-muted/50 px-3 py-2 text-sm">
            <summary className="cursor-pointer list-none text-muted-foreground select-none">
              <span className="eyebrow">Сервер</span>{" "}
              <span className="ml-1 font-mono text-xs">{demo ? "демо (в браузере)" : server}</span>
            </summary>
            <div className="mt-3 space-y-2">
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setServerDraft(DEMO_SERVER)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs",
                    demo ? "border-foreground bg-card" : "text-muted-foreground",
                  )}
                >
                  Демо
                </button>
                <button
                  type="button"
                  onClick={() => setServerDraft(demo ? "http://127.0.0.1:18400" : server)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs",
                    !demo ? "border-foreground bg-card" : "text-muted-foreground",
                  )}
                >
                  Okapi
                </button>
              </div>
              {!demo && (
                <Input
                  value={server}
                  onChange={(e) => setServerDraft(e.target.value)}
                  placeholder="https://bmap.example.com"
                  className="font-mono text-xs"
                />
              )}
              <p className="text-xs text-muted-foreground">
                {demo
                  ? `Данные хранятся в этом браузере. Логин viewer / viewer, ключ редактора: ${DEMO_EDITOR_KEY}. Регистрация тоже работает локально.`
                  : "Адрес бэкенда без /api. «/» — тот же домен. Регистрация доступна только для Okapi."}
              </p>
            </div>
          </details>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? (isRegister ? "Создаём…" : "Входим…") : isRegister ? "Зарегистрироваться" : "Войти"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
