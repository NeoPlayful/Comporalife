import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import ConfirmDialog from './ConfirmDialog';

/**
 * 命令式确认框。
 *
 * 页面里的确认点大多长在 `.map` 回调或行内 onClick 里，如果用受控 state 接入，
 * 每个页面都要多出一份「当前在确认什么」的状态和一段渲染分支。这里改成
 * Promise 形式——`if (await confirm({...}))` 即可，调用点保持原本的写法。
 *
 * 全局同时只允许一个确认框：第二个请求进来时先把它前一个当作「取消」结掉，
 * 否则前一个 Promise 永远不会 resolve，调用方会一直挂着。
 */
export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

type Resolver = (value: boolean) => void;

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: Resolver } | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending((current) => {
        current?.resolve(false);
        return { options, resolve };
      });
    });
  }, []);

  const settle = (value: boolean) => {
    setPending((current) => {
      current?.resolve(value);
      return null;
    });
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.options.title ?? ''}
        message={pending?.options.message}
        confirmLabel={pending?.options.confirmLabel}
        cancelLabel={pending?.options.cancelLabel}
        tone={pending?.options.tone}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm 必须在 ConfirmProvider 内使用');
  return context;
}
