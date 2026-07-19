import type { SupabaseClient } from "@supabase/supabase-js";

import { sortActivitiesNewestFirst } from "@/lib/activityIntelligence";
import type {
  OperationalRefreshChain,
  OperationalRefreshChainNode,
  OperationalRefreshDataset,
  OperationalRefreshProperty,
} from "@/lib/operationalSummary/types";

export function buildOperationalRefreshDataset(params: {
  chain: OperationalRefreshChain;
  properties: OperationalRefreshProperty[];
  chainNodes: OperationalRefreshChainNode[];
}): OperationalRefreshDataset {
  return {
    chain: params.chain,
    properties: params.properties,
    chainNodes: params.chainNodes,
  };
}

export async function loadOperationalRefreshDataset(
  supabase: SupabaseClient,
  chainId: number
): Promise<OperationalRefreshDataset | null> {
  const { data: chainRow, error: chainError } =
    await supabase
      .from("chains")
      .select(
        "id, completion_lifecycle_status, completion_scheduled_date, completion_confirmed_at, completed_at"
      )
      .eq("id", chainId)
      .maybeSingle();

  if (chainError || !chainRow) {
    console.error(chainError);
    return null;
  }

  const {
    data: participantProperties,
    error: propertiesError,
  } = await supabase
    .from("chain_properties_participant")
    .select(
      "id, chain_id, chain_position, stage, status, address, stage_entered_at"
    )
    .eq("chain_id", chainId)
    .order("chain_position");

  if (propertiesError || !participantProperties) {
    console.error(propertiesError);
    return null;
  }

  const propertyIds = participantProperties.map(
    (property) => property.id
  );

  const activitiesByPropertyId = new Map<
    number,
    OperationalRefreshProperty["activities"]
  >();

  if (propertyIds.length > 0) {
    const {
      data: propertyActivities,
      error: propertyActivitiesError,
    } = await supabase
      .from("activities")
      .select(
        "id, timestamp, update, updated_by, property_id"
      )
      .in("property_id", propertyIds);

    if (propertyActivitiesError) {
      console.error(propertyActivitiesError);
    } else {
      for (const activity of propertyActivities || []) {
        if (!activity.property_id) {
          continue;
        }

        const existing =
          activitiesByPropertyId.get(
            activity.property_id
          ) || [];

        existing.push({
          id: activity.id,
          timestamp: activity.timestamp,
          update: activity.update,
          updated_by: activity.updated_by,
        });

        activitiesByPropertyId.set(
          activity.property_id,
          existing
        );
      }
    }
  }

  const {
    data: chainNodesData,
    error: chainNodesError,
  } = await supabase
    .from("chain_nodes")
    .select(
      "id, chain_id, node_type, linked_property_id, stage, status, progress, stage_entered_at"
    )
    .eq("chain_id", chainId);

  if (chainNodesError || !chainNodesData) {
    console.error(chainNodesError);
    return null;
  }

  const chainNodeIds = chainNodesData.map(
    (node) => node.id
  );

  const activitiesByChainNodeId = new Map<
    number,
    OperationalRefreshChainNode["activities"]
  >();

  if (chainNodeIds.length > 0) {
    const {
      data: nodeActivities,
      error: nodeActivitiesError,
    } = await supabase
      .from("activities")
      .select(
        "id, timestamp, update, updated_by, chain_node_id"
      )
      .in("chain_node_id", chainNodeIds);

    if (nodeActivitiesError) {
      console.error(nodeActivitiesError);
    } else {
      for (const activity of nodeActivities || []) {
        if (!activity.chain_node_id) {
          continue;
        }

        const existing =
          activitiesByChainNodeId.get(
            activity.chain_node_id
          ) || [];

        existing.push({
          id: activity.id,
          timestamp: activity.timestamp,
          update: activity.update,
          updated_by: activity.updated_by,
        });

        activitiesByChainNodeId.set(
          activity.chain_node_id,
          existing
        );
      }
    }
  }

  const properties: OperationalRefreshProperty[] =
    participantProperties.map((property) => ({
      id: property.id,
      chainId: property.chain_id,
      chainPosition: property.chain_position,
      stage: property.stage,
      status: property.status,
      address: property.address,
      stageEnteredAt: property.stage_entered_at ?? null,
      activities: sortActivitiesNewestFirst(
        activitiesByPropertyId.get(property.id) ||
          []
      ),
    }));

  const chainNodes: OperationalRefreshChainNode[] =
    chainNodesData.map((node) => ({
      id: node.id,
      chain_id: node.chain_id,
      node_type: node.node_type,
      linked_property_id:
        node.linked_property_id,
      stage: node.stage,
      status: node.status,
      progress: node.progress,
      stageEnteredAt: node.stage_entered_at ?? null,
      activities: sortActivitiesNewestFirst(
        activitiesByChainNodeId.get(node.id) || []
      ),
    }));

  const chain: OperationalRefreshChain = {
    id: chainRow.id,
    completionLifecycleStatus:
      chainRow.completion_lifecycle_status,
    completionScheduledDate:
      chainRow.completion_scheduled_date,
    completionConfirmedAt:
      chainRow.completion_confirmed_at,
    completedAt: chainRow.completed_at,
  };

  return {
    chain,
    properties,
    chainNodes,
  };
}

/** Service-role dataset load for scheduled intelligence refresh. */
export async function loadOperationalRefreshDatasetForWorker(
  supabase: SupabaseClient,
  chainId: number
): Promise<OperationalRefreshDataset | null> {
  const { data: chainRow, error: chainError } = await supabase
    .from("chains")
    .select(
      "id, completion_lifecycle_status, completion_scheduled_date, completion_confirmed_at, completed_at"
    )
    .eq("id", chainId)
    .maybeSingle();

  if (chainError || !chainRow) {
    console.error(chainError);
    return null;
  }

  const { data: propertiesData, error: propertiesError } =
    await supabase
      .from("properties")
      .select(
        "id, chain_id, chain_position, stage, status, address, stage_entered_at"
      )
      .eq("chain_id", chainId)
      .order("chain_position");

  if (propertiesError || !propertiesData) {
    console.error(propertiesError);
    return null;
  }

  const propertyIds = propertiesData.map((property) => property.id);
  const activitiesByPropertyId = new Map<
    number,
    OperationalRefreshProperty["activities"]
  >();

  if (propertyIds.length > 0) {
    const { data: propertyActivities, error: propertyActivitiesError } =
      await supabase
        .from("activities")
        .select(
          "id, timestamp, update, updated_by, property_id"
        )
        .in("property_id", propertyIds);

    if (propertyActivitiesError) {
      console.error(propertyActivitiesError);
    } else {
      for (const activity of propertyActivities || []) {
        if (!activity.property_id) {
          continue;
        }

        const existing =
          activitiesByPropertyId.get(activity.property_id) || [];

        existing.push({
          id: activity.id,
          timestamp: activity.timestamp,
          update: activity.update,
          updated_by: activity.updated_by,
        });

        activitiesByPropertyId.set(activity.property_id, existing);
      }
    }
  }

  const { data: chainNodesData, error: chainNodesError } =
    await supabase
      .from("chain_nodes")
      .select(
        "id, chain_id, node_type, linked_property_id, stage, status, progress, stage_entered_at"
      )
      .eq("chain_id", chainId);

  if (chainNodesError || !chainNodesData) {
    console.error(chainNodesError);
    return null;
  }

  const chainNodeIds = chainNodesData.map((node) => node.id);
  const activitiesByChainNodeId = new Map<
    number,
    OperationalRefreshChainNode["activities"]
  >();

  if (chainNodeIds.length > 0) {
    const { data: nodeActivities, error: nodeActivitiesError } =
      await supabase
        .from("activities")
        .select(
          "id, timestamp, update, updated_by, chain_node_id"
        )
        .in("chain_node_id", chainNodeIds);

    if (nodeActivitiesError) {
      console.error(nodeActivitiesError);
    } else {
      for (const activity of nodeActivities || []) {
        if (!activity.chain_node_id) {
          continue;
        }

        const existing =
          activitiesByChainNodeId.get(activity.chain_node_id) ||
          [];

        existing.push({
          id: activity.id,
          timestamp: activity.timestamp,
          update: activity.update,
          updated_by: activity.updated_by,
        });

        activitiesByChainNodeId.set(
          activity.chain_node_id,
          existing
        );
      }
    }
  }

  const properties: OperationalRefreshProperty[] =
    propertiesData.map((property) => ({
      id: property.id,
      chainId: property.chain_id,
      chainPosition: property.chain_position,
      stage: property.stage,
      status: property.status,
      address: property.address,
      stageEnteredAt: property.stage_entered_at ?? null,
      activities: sortActivitiesNewestFirst(
        activitiesByPropertyId.get(property.id) || []
      ),
    }));

  const chainNodes: OperationalRefreshChainNode[] =
    chainNodesData.map((node) => ({
      id: node.id,
      chain_id: node.chain_id,
      node_type: node.node_type,
      linked_property_id: node.linked_property_id,
      stage: node.stage,
      status: node.status,
      progress: node.progress,
      stageEnteredAt: node.stage_entered_at ?? null,
      activities: sortActivitiesNewestFirst(
        activitiesByChainNodeId.get(node.id) || []
      ),
    }));

  const chain: OperationalRefreshChain = {
    id: chainRow.id,
    completionLifecycleStatus:
      chainRow.completion_lifecycle_status,
    completionScheduledDate:
      chainRow.completion_scheduled_date,
    completionConfirmedAt: chainRow.completion_confirmed_at,
    completedAt: chainRow.completed_at,
  };

  return {
    chain,
    properties,
    chainNodes,
  };
}
