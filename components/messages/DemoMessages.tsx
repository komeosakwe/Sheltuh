import DemoNotice from "@/components/DemoNotice";
import { fieldClass } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Section";
import { SAMPLE_CONVERSATION, SAMPLE_MESSAGES, SAMPLE_NOW } from "@/lib/sample-messages";
import MessageList from "./MessageList";

/**
 * Messages in demo mode: a notice and a fixed sample conversation to show
 * what it looks like. Nothing here calls the API, and the composer is disabled.
 */
export default function DemoMessages() {
  const conversation = SAMPLE_CONVERSATION;
  return (
    <div className="flex flex-col gap-8">
      <DemoNotice>Messages aren&rsquo;t available in this demo. This is a sample conversation.</DemoNotice>
      <Panel title={`Sample: ${conversation.otherDisplayName}`} titleId="demo-thread-title">
        {conversation.event && <p className="mb-5 text-sm text-muted">Going to {conversation.event.title}</p>}
        <MessageList messages={SAMPLE_MESSAGES} otherName={conversation.otherDisplayName} now={SAMPLE_NOW} />
        <div className="mt-6 flex flex-col gap-3 border-t border-surface-border pt-4">
          <label htmlFor="demo-message" className="eyebrow text-muted">
            Your message
          </label>
          <textarea id="demo-message" rows={2} disabled className={fieldClass} />
          <button
            type="button"
            disabled
            className="btn btn-lg w-full cursor-not-allowed border-surface-border bg-surface-border text-muted sm:w-auto sm:self-start"
          >
            Send
          </button>
        </div>
      </Panel>
    </div>
  );
}
