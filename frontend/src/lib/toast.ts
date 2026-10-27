import toast, { ToastOptions } from 'react-hot-toast';

/**
 * 全局轻提示。
 *
 * 业务侧只调这里的三个函数，不直接 import react-hot-toast——否则配色、
 * 时长、位置会在几十个调用点各写一遍，改一次要改一圈。
 *
 * 成功与失败只描述「刚才那个动作的结果」，需要用户拍板的决定走 ConfirmDialog。
 */

// 提示要盖在弹窗之上：弹窗基础层是 50 且叠开时递增，这里抬到 90 留出余量
const BASE: ToastOptions = {
  duration: 3500,
  className: 'cl-toast',
};

export function toastSuccess(message: string) {
  toast.success(message, BASE);
}

export function toastError(message: string) {
  // 失败信息用户往往需要读清楚再去重试，停留更久
  toast.error(message, { ...BASE, duration: 5000 });
}

/** 中性提示：不是成功也不是失败，例如「全部组合已存在」 */
export function toastInfo(message: string) {
  toast(message, BASE);
}

export function dismissToasts() {
  toast.dismiss();
}

export { Toaster } from 'react-hot-toast';
