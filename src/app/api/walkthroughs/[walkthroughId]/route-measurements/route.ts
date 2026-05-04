import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { getProjectById, upsertProject } from "@/lib/local-store";
import { saveRouteMeasurement } from "@/lib/walkthrough-session";
import type { RouteClass, RouteType } from "@/lib/types";

type RouteMeasurementsRouteProps = {
  params: Promise<{ walkthroughId: string }>;
};

type RouteMeasurementRequest = {
  projectId?: string;
  id?: string;
  sourceLocation?: string;
  destinationSectionId?: string;
  destinationDescription?: string;
  routeType?: RouteType;
  measuredDistanceFt?: number;
  routeClass?: RouteClass;
  circuitAmpRating?: number;
  requiresMeasuredDistance?: boolean;
  requiresReview?: boolean;
  notes?: string;
};

export async function POST(
  request: Request,
  { params }: RouteMeasurementsRouteProps,
) {
  const { response } = await requireApiSession();

  if (response) {
    return response;
  }

  const { walkthroughId } = await params;
  const body = (await request.json()) as RouteMeasurementRequest;

  if (!body.projectId || !body.sourceLocation) {
    return NextResponse.json(
      { error: "projectId and sourceLocation are required." },
      { status: 400 },
    );
  }

  const project = await getProjectById(body.projectId);

  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  try {
    const updatedProject = saveRouteMeasurement(project, {
      id: body.id,
      walkthroughId,
      sourceLocation: body.sourceLocation,
      destinationSectionId: body.destinationSectionId,
      destinationDescription: body.destinationDescription,
      routeType: body.routeType,
      measuredDistanceFt: body.measuredDistanceFt,
      routeClass: body.routeClass,
      circuitAmpRating: body.circuitAmpRating,
      requiresMeasuredDistance: body.requiresMeasuredDistance,
      requiresReview: body.requiresReview,
      notes: body.notes,
    });
    const savedProject = await upsertProject(updatedProject);
    const routeMeasurement = savedProject.routeMeasurements?.find(
      (item) => item.id === (body.id ?? updatedProject.routeMeasurements?.[0]?.id),
    );

    return NextResponse.json({ project: savedProject, routeMeasurement });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Route measurement could not be saved.",
      },
      { status: 404 },
    );
  }
}
