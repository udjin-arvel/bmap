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
import { buttonVariants } from "@/components/ui/button";
import { useEditor } from "@/lib/bmap/store";

export function ConfirmDeleteModal() {
  const id = useEditor((s) => s.confirmDeleteId);
  const node = useEditor((s) => s.nodes.find((n) => n.id === s.confirmDeleteId));
  const edgeCount = useEditor(
    (s) => s.edges.filter((e) => e.source === s.confirmDeleteId || e.target === s.confirmDeleteId).length,
  );
  const { set, deleteNode } = useEditor.getState();

  return (
    <AlertDialog open={!!id} onOpenChange={(o) => !o && set({ confirmDeleteId: null })}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить узел и все его связи?</AlertDialogTitle>
          <AlertDialogDescription>
            «{node?.data.name}» будет удалён вместе со связями ({edgeCount}). Действие можно отменить
            через Ctrl+Z.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={() => id && void deleteNode(id)}
          >
            Удалить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
