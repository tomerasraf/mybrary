"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { friendlyAiError } from "@/lib/ai/client";
import { buildSnapshotText } from "@/lib/ai/context";
import { extractTasks, reflect } from "@/lib/ai/tasks";
import { upsertCheckin } from "@/lib/repo/checkins";
import { addEntry, deleteEntry, getEntry, updateEntry } from "@/lib/repo/diary";
import { clearMessages, recentMessages } from "@/lib/repo/conversation";
import {
  ITEM_KINDS,
  createItem,
  deleteItem,
  moveItem,
  setItemStatus,
  setNextStep,
} from "@/lib/repo/items";
import { MEMORY_CATEGORIES, addMemory, applyReflection, deleteMemory, updateMemory } from "@/lib/repo/memories";
import { PLACE_CATEGORIES, PLACE_STATUSES, createPlace, deletePlace, setPlaceLocation, setPlaceStatus } from "@/lib/repo/places";
import { setRoomFocus } from "@/lib/repo/rooms";
import { ROOM_IDS } from "@/lib/rooms";
import { todayKey } from "@/lib/time";

export interface ActionResult<T = undefined> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

const ok = <T>(data?: T): ActionResult<T> => ({ success: true, data });
const fail = (error: string): ActionResult<never> => ({ success: false, error });

function refreshAll(): void {
  revalidatePath("/", "layout");
}

const Id = z.number().int().positive();
const Room = z.enum(ROOM_IDS);

// ---------- Diary ----------

const Mood = z.number().int().min(1).max(5).nullable();

export async function writeEntryAction(raw: unknown): Promise<ActionResult<{ id: number }>> {
  const input = z.object({ body: z.string().trim().min(1).max(20000), mood: Mood.default(null) }).safeParse(raw);
  if (!input.success) return fail("Write something first (up to 20,000 characters).");
  const entry = addEntry({ date: todayKey(), ...input.data });
  refreshAll();
  return ok({ id: entry.id });
}

export async function updateEntryAction(id: unknown, body: unknown): Promise<ActionResult> {
  const parsed = z.tuple([Id, z.string().trim().min(1).max(20000)]).safeParse([id, body]);
  if (!parsed.success) return fail("An entry can't be empty.");
  updateEntry(parsed.data[0], parsed.data[1]);
  refreshAll();
  return ok();
}

export async function deleteEntryAction(id: unknown): Promise<ActionResult> {
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Invalid entry.");
  deleteEntry(parsed.data);
  refreshAll();
  return ok();
}

export async function extractTasksAction(id: unknown): Promise<ActionResult<{ reply: string; count: number }>> {
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Invalid entry.");
  const entry = getEntry(parsed.data);
  if (!entry) return fail("That entry no longer exists.");
  try {
    const result = await extractTasks(entry.body, buildSnapshotText());
    result.items.forEach((item) => createItem(item));
    refreshAll();
    return ok({ reply: result.reply, count: result.items.length });
  } catch (error) {
    console.error("[diary] extract failed", error);
    return fail(friendlyAiError(error));
  }
}

// ---------- Check-in ----------

const CheckinInput = z.object({
  mood: z.number().int().min(1).max(5),
  energy: z.number().int().min(1).max(5),
  note: z.string().trim().max(1000).default(""),
});

export async function saveCheckin(raw: unknown): Promise<ActionResult> {
  const input = CheckinInput.safeParse(raw);
  if (!input.success) return fail("Pick a mood and energy level.");
  upsertCheckin({ date: todayKey(), ...input.data });
  refreshAll();
  return ok();
}

// ---------- Items & rooms ----------

export async function addItemAction(raw: unknown): Promise<ActionResult> {
  const input = z
    .object({ room: Room, title: z.string().trim().min(1).max(300), kind: z.enum(ITEM_KINDS).default("task") })
    .safeParse(raw);
  if (!input.success) return fail("Give it a title.");
  createItem(input.data);
  refreshAll();
  return ok();
}

export async function toggleItemAction(id: unknown, done: unknown): Promise<ActionResult> {
  const parsed = z.tuple([Id, z.boolean()]).safeParse([id, done]);
  if (!parsed.success) return fail("Invalid item.");
  setItemStatus(parsed.data[0], parsed.data[1] ? "done" : "open");
  refreshAll();
  return ok();
}

export async function setNextAction(id: unknown): Promise<ActionResult> {
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Invalid item.");
  setNextStep(parsed.data);
  refreshAll();
  return ok();
}

export async function moveItemAction(id: unknown, room: unknown): Promise<ActionResult> {
  const parsed = z.tuple([Id, Room]).safeParse([id, room]);
  if (!parsed.success) return fail("Invalid move.");
  moveItem(parsed.data[0], parsed.data[1]);
  refreshAll();
  return ok();
}

export async function deleteItemAction(id: unknown): Promise<ActionResult> {
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Invalid item.");
  deleteItem(parsed.data);
  refreshAll();
  return ok();
}

export async function setFocusAction(room: unknown, focus: unknown): Promise<ActionResult> {
  const parsed = z.tuple([Room, z.string().trim().max(300)]).safeParse([room, focus]);
  if (!parsed.success) return fail("Focus must be under 300 characters.");
  setRoomFocus(parsed.data[0], parsed.data[1]);
  refreshAll();
  return ok();
}

// ---------- Places ----------

export async function addPlaceAction(raw: unknown): Promise<ActionResult> {
  const input = z
    .object({
      name: z.string().trim().min(1).max(200),
      category: z.enum(PLACE_CATEGORIES),
      area: z.string().trim().max(100).default(""),
      notes: z.string().trim().max(1000).default(""),
      lat: z.number().min(-90).max(90).nullable().default(null),
      lng: z.number().min(-180).max(180).nullable().default(null),
    })
    .safeParse(raw);
  if (!input.success) return fail("A place needs a name.");
  createPlace(input.data);
  refreshAll();
  return ok();
}

export async function setPlaceStatusAction(id: unknown, status: unknown): Promise<ActionResult> {
  const parsed = z.tuple([Id, z.enum(PLACE_STATUSES)]).safeParse([id, status]);
  if (!parsed.success) return fail("Invalid place.");
  setPlaceStatus(parsed.data[0], parsed.data[1]);
  refreshAll();
  return ok();
}

export async function setPlaceLocationAction(id: unknown, lat: unknown, lng: unknown): Promise<ActionResult> {
  const parsed = z.tuple([Id, z.number().min(-90).max(90), z.number().min(-180).max(180)]).safeParse([id, lat, lng]);
  if (!parsed.success) return fail("Invalid location.");
  setPlaceLocation(...parsed.data);
  refreshAll();
  return ok();
}

export async function deletePlaceAction(id: unknown): Promise<ActionResult> {
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Invalid place.");
  deletePlace(parsed.data);
  refreshAll();
  return ok();
}

// ---------- Memory / learning ----------

export async function reflectAction(): Promise<ActionResult<{ summary: string; added: number; removed: number }>> {
  try {
    const conversation = recentMessages(40)
      .map((m) => `${m.role === "user" ? "Me" : "Ember"}: ${m.content}`)
      .join("\n");
    const result = await reflect(buildSnapshotText(), conversation);
    const counts = applyReflection(result.add, result.removeIds);
    refreshAll();
    return ok({ summary: result.summary, ...counts });
  } catch (error) {
    console.error("[reflect] failed", error);
    return fail(friendlyAiError(error));
  }
}

export async function addMemoryAction(raw: unknown): Promise<ActionResult> {
  const input = z
    .object({ fact: z.string().trim().min(1).max(500), category: z.enum(MEMORY_CATEGORIES) })
    .safeParse(raw);
  if (!input.success) return fail("Write the thing you want Ember to remember.");
  addMemory(input.data.fact, input.data.category);
  refreshAll();
  return ok();
}

export async function updateMemoryAction(id: unknown, fact: unknown): Promise<ActionResult> {
  const parsed = z.tuple([Id, z.string().trim().min(1).max(500)]).safeParse([id, fact]);
  if (!parsed.success) return fail("Memory can't be empty.");
  updateMemory(parsed.data[0], parsed.data[1]);
  refreshAll();
  return ok();
}

export async function deleteMemoryAction(id: unknown): Promise<ActionResult> {
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Invalid memory.");
  deleteMemory(parsed.data);
  refreshAll();
  return ok();
}

export async function clearChatAction(): Promise<ActionResult> {
  clearMessages();
  refreshAll();
  return ok();
}
