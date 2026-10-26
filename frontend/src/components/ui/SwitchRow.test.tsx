import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SwitchRow from './SwitchRow';

describe('SwitchRow', () => {
  it('以 switch 角色暴露当前状态', () => {
    const { rerender } = render(
      <SwitchRow title="公开注册" checked={false} onCheckedChange={() => {}} />,
    );

    const sw = screen.getByRole('switch', { name: '公开注册' });
    expect(sw).toHaveAttribute('aria-checked', 'false');

    rerender(<SwitchRow title="公开注册" checked onCheckedChange={() => {}} />);
    expect(screen.getByRole('switch', { name: '公开注册' })).toHaveAttribute('aria-checked', 'true');
  });

  it('点击整行按相反状态回调，但不自行改变状态', () => {
    const onCheckedChange = vi.fn();
    render(<SwitchRow title="邮箱验证" checked={false} onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole('switch', { name: '邮箱验证' }));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
    // 受控组件：调用方不更新 checked，视觉与 aria 都不应变
    expect(screen.getByRole('switch', { name: '邮箱验证' })).toHaveAttribute('aria-checked', 'false');
  });

  it('确认被取消时保持原状态', () => {
    const onCheckedChange = vi.fn();
    render(<SwitchRow title="公开注册" checked onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole('switch', { name: '公开注册' }));

    expect(onCheckedChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('switch', { name: '公开注册' })).toHaveAttribute('aria-checked', 'true');
  });

  it('是原生按钮，键盘可获得焦点并按默认激活方式操作', () => {
    render(<SwitchRow title="公开注册" checked={false} onCheckedChange={() => {}} />);

    const sw = screen.getByRole('switch', { name: '公开注册' });
    expect(sw.tagName).toBe('BUTTON');
    expect(sw).toHaveAttribute('type', 'button');

    sw.focus();
    expect(sw).toHaveFocus();
  });

  it('禁用时不触发回调且带禁用说明', () => {
    const onCheckedChange = vi.fn();
    render(
      <SwitchRow
        title="公开注册"
        checked={false}
        disabled
        disabledHint="当前角色无修改权限"
        onCheckedChange={onCheckedChange}
      />,
    );

    const sw = screen.getByRole('switch', { name: '公开注册' });
    expect(sw).toBeDisabled();
    expect(screen.getByText('当前角色无修改权限')).toBeInTheDocument();

    fireEvent.click(sw);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('提交中禁用并标记 busy', () => {
    render(<SwitchRow title="公开注册" checked pending onCheckedChange={() => {}} />);

    const sw = screen.getByRole('switch', { name: '公开注册' });
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute('aria-busy', 'true');
  });

  it('提供状态文字时不改变无障碍名称', () => {
    render(
      <SwitchRow
        title="公开注册"
        checked
        onLabel="已开启"
        offLabel="已关闭"
        onCheckedChange={() => {}}
      />,
    );

    const sw = screen.getByRole('switch', { name: '公开注册' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('已开启')).toBeInTheDocument();
  });
});
