import { NumberField } from "@base-ui/react/number-field";
import { Minus, Plus } from "lucide-react";

import Field, { controlClass } from "~/components/field";
import { useI18n } from "~/i18n/react";
import cn from "~/utils/cn";

export interface NumberInputProps {
  label: string;
  name?: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  value?: number;
  onValueChange?: (value: number | null) => void;
}

const stepperClass = cn(
  "grid size-7 place-items-center rounded-sm text-muted",
  "hover:bg-hover hover:text-fg",
);

export default function NumberInput({
  label,
  name,
  description,
  disabled,
  ...props
}: NumberInputProps) {
  const { locale, t } = useI18n();
  // name goes on Root, which submits the raw number via a hidden input.
  // The visible Input holds the locale-formatted string.
  return (
    <Field description={description} disabled={disabled} label={label} name={name}>
      <NumberField.Root
        locale={locale}
        defaultValue={props.defaultValue}
        max={props.max}
        min={props.min}
        name={name}
        onValueChange={props.onValueChange}
        required={props.required}
        step={props.step}
        value={props.value}
      >
        <NumberField.Group className={cn(controlClass, "flex items-center pr-0.5")}>
          <NumberField.Input className="h-full w-full bg-transparent pl-2.5 outline-hidden" />
          <NumberField.Decrement
            aria-label={t("components.actions.decrement")}
            className={stepperClass}
          >
            <Minus className="size-3.5" />
          </NumberField.Decrement>
          <NumberField.Increment
            aria-label={t("components.actions.increment")}
            className={stepperClass}
          >
            <Plus className="size-3.5" />
          </NumberField.Increment>
        </NumberField.Group>
      </NumberField.Root>
    </Field>
  );
}
