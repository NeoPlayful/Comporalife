import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import Modal from './Modal';

// Modal 依赖 i18n 的 common:modal.discard_confirm 与 actions.close
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'actions.close': '关闭',
        'actions.cancel': '取消',
        'actions.confirm': '确认',
        'modal.discard_title': '放弃未保存的修改？',
        'modal.discard_confirm': '还有未保存的内容，关闭后这些修改会丢失。',
        'modal.discard_confirm_action': '放弃并关闭',
        'modal.discard_keep_editing': '继续编辑',
      };
      return map[key] ?? key;
    },
  }),
}));

function Harness({
  dirty = false,
  busy = false,
  onClose,
}: {
  dirty?: boolean;
  busy?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        打开
      </button>
      <button type="button">弹窗外的按钮</button>
      <Modal
        open={open}
        title="测试弹窗"
        dirty={dirty}
        busy={busy}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
        footer={
          <button type="button" onClick={() => setOpen(false)}>
            底部关闭
          </button>
        }
      >
        <button type="button">弹窗内第一个</button>
        <button type="button" data-autofocus>
          弹窗内聚焦目标
        </button>
      </Modal>
    </div>
  );
}

describe('Modal', () => {
  it('打开后暴露 dialog 语义并以标题命名', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('打开'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(screen.getByRole('heading', { name: '测试弹窗' })).toBeInTheDocument();
  });

  it('关闭时不渲染任何弹窗节点', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('打开'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('初始焦点落在 data-autofocus 元素上', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('打开'));

    expect(screen.getByText('弹窗内聚焦目标')).toHaveFocus();
  });

  it('Esc 关闭并把焦点还给触发按钮', () => {
    render(<Harness />);
    const trigger = screen.getByText('打开');
    // jsdom 点击不会自动聚焦按钮，先手动聚焦以模拟真实浏览器的行为
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('提交中按 Esc 不关闭', () => {
    render(<Harness busy />);
    fireEvent.click(screen.getByText('打开'));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('有脏数据时弹出确认层，继续编辑可阻止关闭', () => {
    const onClose = vi.fn();

    render(<Harness dirty onClose={onClose} />);
    fireEvent.click(screen.getByText('打开'));

    fireEvent.keyDown(document, { key: 'Escape' });
    // 原弹窗仍在，确认层叠在它之上
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(screen.getByText('放弃未保存的修改？')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('继续编辑'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('有脏数据时确认后才关闭', () => {
    const onClose = vi.fn();

    render(<Harness dirty onClose={onClose} />);
    fireEvent.click(screen.getByText('打开'));

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByText('放弃并关闭'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('无脏数据时不弹确认', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('打开'));

    fireEvent.keyDown(document, { key: 'Escape' });

    // 直接关掉，不会出现第二层
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('放弃未保存的修改？')).not.toBeInTheDocument();
  });

  it('Tab 在最后一个可聚焦元素上回环到第一个', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('打开'));

    const dialog = screen.getByRole('dialog');
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    const last = focusables[focusables.length - 1]!;
    last.focus();

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(focusables[0]).toHaveFocus();
  });

  it('Shift+Tab 在第一个可聚焦元素上回环到最后一个', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('打开'));

    const dialog = screen.getByRole('dialog');
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    focusables[0]!.focus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(focusables[focusables.length - 1]).toHaveFocus();
  });

  it('打开时锁定页面滚动，关闭后恢复', () => {
    render(<Harness />);
    const before = document.body.style.overflow;

    fireEvent.click(screen.getByText('打开'));
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.body.style.overflow).toBe(before);
  });

  it('叠加两层时只有上层响应 Esc', () => {
    function Nested() {
      const [first, setFirst] = useState(false);
      const [second, setSecond] = useState(false);

      return (
        <div>
          <button type="button" onClick={() => setFirst(true)}>
            打开第一层
          </button>
          <Modal open={first} title="第一层" onClose={() => setFirst(false)}>
            <button type="button" onClick={() => setSecond(true)}>
              打开第二层
            </button>
          </Modal>
          <Modal open={second} title="第二层" onClose={() => setSecond(false)}>
            <p>第二层内容</p>
          </Modal>
        </div>
      );
    }

    render(<Nested />);
    fireEvent.click(screen.getByText('打开第一层'));
    fireEvent.click(screen.getByText('打开第二层'));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);

    fireEvent.keyDown(document, { key: 'Escape' });

    // 关掉的是上层，第一层仍在
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '第一层' })).toBeInTheDocument();
  });

  it('呈现在页面其他弹窗之上时 z-index 递增', () => {
    function Nested() {
      const [first, setFirst] = useState(false);
      const [second, setSecond] = useState(false);

      return (
        <div>
          <button type="button" onClick={() => setFirst(true)}>
            打开第一层
          </button>
          <Modal open={first} title="第一层" onClose={() => setFirst(false)}>
            <button type="button" onClick={() => setSecond(true)}>
              打开第二层
            </button>
          </Modal>
          <Modal open={second} title="第二层" onClose={() => setSecond(false)}>
            <p>第二层内容</p>
          </Modal>
        </div>
      );
    }

    render(<Nested />);
    fireEvent.click(screen.getByText('打开第一层'));
    fireEvent.click(screen.getByText('打开第二层'));

    const dialogs = screen.getAllByRole('dialog');
    const zOf = (el: HTMLElement) => Number(el.parentElement?.style.zIndex ?? 0);
    expect(zOf(dialogs[1]!)).toBeGreaterThan(zOf(dialogs[0]!));
  });
});
