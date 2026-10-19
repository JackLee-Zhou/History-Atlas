"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Book } from "@/lib/schema";
import { Spinner } from "@/components/ui/spinner";

export interface DeleteBookDialogProps {
  book: Book | null;
  busy?: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(book: Book): Promise<void>;
}

export function DeleteBookDialog({
  book,
  busy = false,
  onOpenChange,
  onConfirm,
}: DeleteBookDialogProps) {
  return (
    <Dialog open={book !== null} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除《{book?.title ?? ""}》</DialogTitle>
          <DialogDescription>
            该书及其分析缓存将被永久删除，无法恢复。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            取消
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (book) void onConfirm(book);
            }}
            disabled={busy}
            aria-label={`确认删除《${book?.title ?? ""}》`}
          >
            {busy ? (
              <Spinner label="正在删除" className="h-4 w-4" />
            ) : (
              <Trash2 className="h-4 w-4" aria-hidden />
            )}
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
