import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useEditor } from "@/lib/bmap/store";

export function AiExpandConfirmModal() {
  const nodeId = useEditor((s) => s.confirmAiExpandId);
  const name = useEditor((s) => s.nodes.find((n) => n.id === s.confirmAiExpandId)?.data.name);
  const { set, expandNode } = useEditor.getState();

  return (
    <AlertDialog open={!!nodeId} onOpenChange={(open) => !open && set({ confirmAiExpandId: null })}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Заменить AI-продолжение?</AlertDialogTitle>
          <AlertDialogDescription>
            У узла «{name ?? "…"}» уже есть цепочка, созданная AI. Новый запрос удалит старые AI-узлы
            вокруг него и построит ветку заново.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={() => nodeId && void expandNode(nodeId, true)}>Заменить</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
