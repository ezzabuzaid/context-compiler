import {
  Button,
  ButtonGroup,
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@zukhruf/shadcn';
import { useId, useState } from 'react';

const pad = (value: number) => String(value).padStart(2, '0');

// The local day of a date, as a date input's value reads: YYYY-MM-DD.
export const localDay = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// A local day picked from shadcn's date picker (its DatePickerSimple example),
// with the value of a date input: a YYYY-MM-DD day, or undefined for none.
// The month and year are lists, so a day years back takes no paging; the years
// run a year past today or the day picked, as an import may end in the future.
export function DatePicker({
  label,
  day,
  onChange,
}: {
  label: string;
  day: string | undefined;
  onChange: (day: string | undefined) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [today] = useState(() => new Date());
  const selected = day === undefined ? undefined : new Date(`${day}T00:00:00`);
  const last = selected === undefined || selected < today ? today : selected;
  return (
    <div>
      <label id={`${id}-label`} htmlFor={id} className="form-label">
        {label}
      </label>
      <ButtonGroup>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            id={id}
            aria-labelledby={`${id}-label ${id}`}
            render={
              <Button
                variant="outline"
                className="justify-start px-2.5 font-normal"
              />
            }
          >
            {/* lucide's calendar icon, as shadcn's example shows. */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              data-icon="inline-start"
            >
              <path d="M8 2v4" />
              <path d="M16 2v4" />
              <rect width="18" height="18" x="3" y="4" rx="2" />
              <path d="M3 10h18" />
            </svg>
            {selected === undefined
              ? 'Any day'
              : selected.toLocaleDateString(undefined, { dateStyle: 'long' })}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              captionLayout="dropdown"
              selected={selected}
              defaultMonth={selected}
              endMonth={new Date(last.getFullYear() + 1, 11)}
              onSelect={(date) => {
                onChange(date === undefined ? undefined : localDay(date));
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        {selected !== undefined && (
          <Button
            variant="outline"
            size="icon"
            aria-label={`Clear ${label}`}
            onClick={() => onChange(undefined)}
          >
            {/* lucide's x icon. */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </Button>
        )}
      </ButtonGroup>
    </div>
  );
}
