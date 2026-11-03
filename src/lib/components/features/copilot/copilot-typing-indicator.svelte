<!-- "Generating response" placeholder shown while a turn streams. The bars animate
     via the `chat-gen-bar*` keyframes in #lib/styles/chat-animations.css (CSS-driven,
     not GSAP), so this component holds no motion logic of its own. -->
<div class="mb-3 flex justify-start" role="status" aria-label="Generating response">
    <div class="chat-message-enter">
        <div
            class="border-chat-border-subtle bg-chat-bot-bubble flex items-end gap-[3px] rounded-2xl rounded-bl-md border border-solid px-4 py-3"
            aria-hidden="true"
        >
            <span class="chat-gen-bar chat-gen-bar-1 bg-chat-text-secondary/40 h-[18px] w-0.5 rounded-[1px]"></span>
            <span class="chat-gen-bar chat-gen-bar-2 bg-chat-text-secondary/40 h-[18px] w-0.5 rounded-[1px]"></span>
            <span class="chat-gen-bar chat-gen-bar-3 bg-chat-text-secondary/40 h-[18px] w-0.5 rounded-[1px]"></span>
            <span class="chat-gen-bar chat-gen-bar-4 bg-chat-text-secondary/40 h-[18px] w-0.5 rounded-[1px]"></span>
            <span class="chat-gen-bar chat-gen-bar-5 bg-chat-text-secondary/40 h-[18px] w-0.5 rounded-[1px]"></span>
        </div>
        <span class="sr-only">Generating response…</span>
    </div>
</div>
