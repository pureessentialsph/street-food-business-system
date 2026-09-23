import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { Field, TextInput } from "@/components/ui/field";

/**
 * The two password boxes, shared by "create a login" and "reset a password" so both
 * screens ask for the same thing in the same words.
 */
export function PasswordFields({ label = "Password", hint }: { label?: string; hint?: string }) {
  return (
    <>
      <Field
        label={label}
        name="password"
        required
        hint={hint ?? `At least ${MIN_PASSWORD_LENGTH} characters. Tell them in person, not by message.`}
      >
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
        />
      </Field>
      <Field label={`${label} again`} name="confirmPassword" required>
        <TextInput
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
    </>
  );
}
