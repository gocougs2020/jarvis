import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api";
import { SkillDocumentError } from "@/lib/skill-document";
import { wrapUserSkillFields, wrapUserSkillPatch } from "@/lib/skill-record";
import {
  createUserSkill,
  deleteUserSkill,
  listUserSkills,
  updateUserSkill,
} from "@/lib/store";
import { isOwnedBy } from "@/lib/visibility";

export async function GET(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  return NextResponse.json({ skills: await listUserSkills(session.user.id) });
}

export async function POST(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const body = (await request.json()) as {
    name?: string;
    slug: string;
    description: string;
    markdown: string;
    enabled?: boolean;
  };
  try {
    return NextResponse.json({
      skill: await createUserSkill(session.user.id, {
        ...wrapUserSkillFields(body),
        enabled: body.enabled,
        visibility: "private",
      }),
    });
  } catch (skillError) {
    if (skillError instanceof SkillDocumentError) {
      return NextResponse.json({ error: skillError.message }, { status: 400 });
    }
    throw skillError;
  }
}

export async function PATCH(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const body = (await request.json()) as {
    id: string;
    name?: string;
    slug?: string;
    description?: string;
    markdown?: string;
    enabled?: boolean;
  };
  const current = (await listUserSkills(session.user.id)).find((skill) => skill.id === body.id);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isOwnedBy(current, session.user.id)) {
    return NextResponse.json({ error: "You can only change skills you created." }, { status: 403 });
  }
  try {
    const skill = await updateUserSkill(
      session.user.id,
      body.id,
      {
        ...wrapUserSkillPatch(current, body),
        },
    );
    if (!skill) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ skill });
  } catch (skillError) {
    if (skillError instanceof SkillDocumentError) {
      return NextResponse.json({ error: skillError.message }, { status: 400 });
    }
    throw skillError;
  }
}

export async function DELETE(request: Request) {
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;
  const { id } = (await request.json()) as { id: string };
  const current = (await listUserSkills(session.user.id)).find((skill) => skill.id === id);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isOwnedBy(current, session.user.id)) {
    return NextResponse.json({ error: "You can only delete skills you created." }, { status: 403 });
  }
  const deleted = await deleteUserSkill(session.user.id, id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
