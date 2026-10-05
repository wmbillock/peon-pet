import { initChat } from '../renderer/chat.js';

const chat = initChat();
chat.show();
window.peonBridge.onChatFocus(() => chat.focusInput());
