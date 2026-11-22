# The date picker: the places that hold it

shadcn ships its date picker as example code only (`DatePickerSimple` in the base-nova `calendar-example`), and `@zukhruf/shadcn` holds no app compositions. So each app composes one from the kit's `Popover`, outline `Button` and `Calendar`. Two apps do, which is strike 2 of the Rule of Three. `zukhruf/no-native-control` refuses the native date input that both replace.

| Place                                     | What it holds                                                                                                                                                                                                                                                                             | Since                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `src/date-picker.tsx` (this package)      | a controlled `day`/`onChange` with a Clear button; always the dropdown caption, ending a year past today or the picked day; the label from `toLocaleDateString`                                                                                                                           | connector From/Until (#5237) |
| Meddit `apps/web/src/app/date-picker.tsx` | the day posts through a hidden `yyyy-MM-dd` input; `defaultValue`, `max` as days disabled after it, an optional dropdown caption with `startMonth`/`endMonth`; `required`, so a picked day cannot be cleared; the label from `dayFormat()`; Arabic narrow weekdays; weeks start on Sunday | birth date and Since (#5235) |

The shared knowledge: the local day as `yyyy-MM-dd` built from local date parts (never `toISOString()`, which moves the day east of UTC), read back as `yyyy-MM-ddT00:00`, and shadcn's composition. The differences are each app's form model, not the knowledge.

Interim rule: a fix to the shared knowledge is made in both files, and the commit names both. A third app that needs a date picker triggers the extraction (zukhruf #5253).
