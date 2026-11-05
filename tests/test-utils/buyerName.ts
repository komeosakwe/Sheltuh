import { fireEvent, screen } from "@testing-library/react";

/** Types a buyer name into the checkout's "Your name" field (every checkout asks for one). */
export function typeName(name = "Alex Doe") {
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: name } });
}
