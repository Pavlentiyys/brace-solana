import { Chat } from "@/components/chat/chat";

/**
 * The app is a conversation now.
 *
 * The screens it used to be are still here and still own their own correctness;
 * they are what the bot answers with. `/chat/reserve` and `/chat/history` remain
 * as direct routes because a link somebody bookmarked should keep working, and
 * because the chat is a way through the product rather than the only door.
 *
 * No page heading. The bot's first message already says what it does, and a
 * title repeating it pushed the conversation a quarter of a screen down.
 */
export default function ChatHome() {
  return (
    // Match the shared site header's 1200px container so the chat rail and
    // conversation align with the wordmark, navigation, and wallet controls.
    <div className="mx-auto flex w-full min-h-0 max-w-[1200px] flex-1 flex-col">
      <Chat />
    </div>
  );
}
