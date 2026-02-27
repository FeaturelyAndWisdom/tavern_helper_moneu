import { createScriptIdIframe, teleportStyle } from '@util/script';
import Window from './Window.vue';

$(() => {
  const app = createApp(Window).use(createPinia());

  const $iframe = createScriptIdIframe()
    .css({
      position: 'fixed',
      top: '100px',
      right: '20px',
      width: '320px',
      height: '400px',
      zIndex: 9999,
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
    })
    .appendTo('body')
    .on('load', function () {
      teleportStyle(this.contentDocument!.head);

      const $body = $(this.contentDocument!.body);
      app.mount($body[0]);

      // 使用 jquery-ui 实现拖拽
      $($iframe).draggable({
        handle: '.window-header',
        containment: 'window',
      });
    });

  // 添加脚本按钮控制窗口显示/隐藏
  appendInexistentScriptButtons([{ name: '切换窗口', visible: true }]);

  eventOn(getButtonEvent('切换窗口'), () => {
    $iframe.toggle();
  });

  // 卸载时清理
  $(window).on('pagehide', () => {
    app.unmount();
    $iframe.remove();
  });
});
