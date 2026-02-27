import { createScriptIdDiv, teleportStyle } from '@util/script';
import Window from './Window.vue';
import './style.scss';

$(() => {
  const app = createApp(Window).use(createPinia());

  const $window = createScriptIdDiv().appendTo('body');
  app.mount($window[0]);

  const { destroy } = teleportStyle();

  // 使用 jquery-ui 实现拖拽
  $window.find('.floating-window').draggable({
    handle: '.floating-window__header',
    containment: 'window',
  });

  // 添加脚本按钮控制窗口显示/隐藏
  appendInexistentScriptButtons([{ name: '切换窗口', visible: true }]);

  eventOn(getButtonEvent('切换窗口'), () => {
    $window.toggle();
  });

  // 卸载时清理
  $(window).on('pagehide', () => {
    app.unmount();
    $window.remove();
    destroy();
  });
});
