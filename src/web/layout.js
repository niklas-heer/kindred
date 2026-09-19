"use strict";
(() => {
  function layout(nodes, edges, { mode = "overview", root = "", sideOrdering = true, roleForEdge = () => "parent", cardWidth = 248, cardHeight = 144 } = {}) {
    const CARD_WIDTH = cardWidth, CARD_HEIGHT = cardHeight;
    const COLUMN_GAP = 36;
    const ROW_GAP = 80;
    const COMPONENT_GAP = 180;
    const X_STEP = CARD_WIDTH + COLUMN_GAP;
    const Y_STEP = CARD_HEIGHT + ROW_GAP;
    const positions = new Map();
    if (!nodes.length) return positions;
    const people = nodes
      .filter((node) => node.kind === "person")
      .sort((left, right) => left.id.localeCompare(right.id));
    const evidence = nodes
      .filter((node) => node.kind !== "person")
      .sort((left, right) => left.id.localeCompare(right.id));
    const personIds = new Set(people.map((person) => person.id));
    const family = globalThis.KindredFamily.analyze(root, edges, roleForEdge);
    const side = (id) => sideOrdering ? ({ maternal: -1, paternal: 1 }[family.people.get(id)] || 0) : 0;
    const birth = (person) => {
      const value = person.metadata?.born ?? person.metadata?.birth;
      return /^\d{4}$/u.test(String(value)) ? Number(value) : Infinity;
    };
    const chronological = (left, right) => birth(left) - birth(right) || left.id.localeCompare(right.id);
    const personEdges = edges.filter((edge) => personIds.has(edge.from) && personIds.has(edge.to));

    if (mode === "path") {
      const adjacency = new Map(people.map((person) => [person.id, []]));
      for (const edge of personEdges) {
        adjacency.get(edge.from)?.push(edge.to);
        adjacency.get(edge.to)?.push(edge.from);
      }
      for (const neighbors of adjacency.values()) neighbors.sort((left, right) => left.localeCompare(right));
      const endpoint = people.find((person) => adjacency.get(person.id)?.length === 1)?.id;
      let current = personIds.has(root) ? root : endpoint || people[0]?.id;
      const ordered = [];
      const visited = new Set();
      while (current && !visited.has(current)) {
        ordered.push(current);
        visited.add(current);
        current = adjacency.get(current)?.find((candidate) => !visited.has(candidate)) || "";
      }
      for (const person of people) if (!visited.has(person.id)) ordered.push(person.id);
      ordered.forEach((id, index) => positions.set(id, { x: index * X_STEP, y: 0 }));
      const evidenceStart = Math.max(0, (ordered.length - evidence.length) * X_STEP / 2);
      evidence.forEach((node, index) => positions.set(node.id, { x: evidenceStart + index * X_STEP, y: Y_STEP }));
    } else {
      const representative = new Map(people.map((person) => [person.id, person.id]));
      const find = (id) => {
        let root = id;
        while (representative.get(root) !== root) root = representative.get(root);
        let cursor = id;
        while (representative.get(cursor) !== root) {
          const next = representative.get(cursor);
          representative.set(cursor, root);
          cursor = next;
        }
        return root;
      };
      const union = (left, right) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot === rightRoot) return;
        const [first, second] = [leftRoot, rightRoot].sort((a, b) => a.localeCompare(b));
        representative.set(second, first);
      };
      for (const edge of personEdges) if (edge.relation === "partner") union(edge.from, edge.to);

      const groupsByRoot = new Map();
      for (const person of people) {
        const root = find(person.id);
        if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
        groupsByRoot.get(root).push(person);
      }
      const groups = [...groupsByRoot.entries()]
        .map(([id, members]) => ({ id, members: members.sort((left, right) => {
          const roleOrder = (person) => {
            const roles = new Set(personEdges.filter((edge) => edge.from === person.id && edge.relation !== "partner").map(roleForEdge));
            const onlyRole = roles.size === 1 ? [...roles][0] : "parent";
            return { mother: -1, father: 1 }[onlyRole] || 0;
          };
          return side(left.id) - side(right.id) || (sideOrdering ? roleOrder(left) - roleOrder(right) : 0) || chronological(left, right);
        }) }))
        .sort((left, right) => left.id.localeCompare(right.id));
      // A person with several partners sits within the group, not at its far edge.
      for (const group of groups) {
        const index = group.members.findIndex((person) => person.id === root);
        if (group.members.length > 2 && index >= 0) {
          const [focus] = group.members.splice(index, 1);
          group.members.splice(Math.floor(group.members.length / 2), 0, focus);
        }
      }
      const groupForPerson = new Map();
      for (const group of groups) for (const member of group.members) groupForPerson.set(member.id, group.id);

      const directedCandidates = [];
      const candidateKeys = new Set();
      for (const edge of personEdges) {
        if (edge.relation === "partner") continue;
        const from = groupForPerson.get(edge.from);
        const to = groupForPerson.get(edge.to);
        const key = `${from}\u0000${to}`;
        if (from && to && from !== to && !candidateKeys.has(key)) {
          candidateKeys.add(key);
          directedCandidates.push({ from, to });
        }
      }
      directedCandidates.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));

      const outgoing = new Map(groups.map((group) => [group.id, []]));
      const incoming = new Map(groups.map((group) => [group.id, []]));
      const reaches = (start, target) => {
        const pending = [start];
        const seen = new Set();
        while (pending.length) {
          const id = pending.pop();
          if (id === target) return true;
          if (seen.has(id)) continue;
          seen.add(id);
          pending.push(...(outgoing.get(id) || []));
        }
        return false;
      };
      for (const edge of directedCandidates) {
        if (reaches(edge.to, edge.from)) continue;
        outgoing.get(edge.from).push(edge.to);
        incoming.get(edge.to).push(edge.from);
      }
      for (const neighbors of [...outgoing.values(), ...incoming.values()]) neighbors.sort((left, right) => left.localeCompare(right));

      const ranks = new Map(groups.map((group) => [group.id, 0]));
      const indegree = new Map(groups.map((group) => [group.id, incoming.get(group.id).length]));
      const ready = groups.filter((group) => indegree.get(group.id) === 0).map((group) => group.id).sort((left, right) => left.localeCompare(right));
      const topological = [];
      while (ready.length) {
        const id = ready.shift();
        topological.push(id);
        for (const child of outgoing.get(id)) {
          ranks.set(child, Math.max(ranks.get(child), ranks.get(id) + 1));
          indegree.set(child, indegree.get(child) - 1);
          if (indegree.get(child) === 0) {
            ready.push(child);
            ready.sort((left, right) => left.localeCompare(right));
          }
        }
      }
      for (const id of [...topological].reverse()) {
        const children = outgoing.get(id);
        if (children.length) {
          const latestParentRank = Math.min(...children.map((child) => ranks.get(child) - 1));
          ranks.set(id, Math.max(ranks.get(id), latestParentRank));
        }
      }

      const weak = new Map(groups.map((group) => [group.id, new Set()]));
      for (const edge of directedCandidates) {
        weak.get(edge.from).add(edge.to);
        weak.get(edge.to).add(edge.from);
      }
      const groupById = new Map(groups.map((group) => [group.id, group]));
      const components = [];
      const assigned = new Set();
      for (const group of groups) {
        if (assigned.has(group.id)) continue;
        const ids = [];
        const pending = [group.id];
        assigned.add(group.id);
        while (pending.length) {
          const id = pending.shift();
          ids.push(id);
          for (const neighbor of [...weak.get(id)].sort((left, right) => left.localeCompare(right))) {
            if (!assigned.has(neighbor)) {
              assigned.add(neighbor);
              pending.push(neighbor);
            }
          }
        }
        components.push(ids.sort((left, right) => left.localeCompare(right)));
      }

      const componentForGroup = new Map();
      components.forEach((component, index) => component.forEach((id) => componentForGroup.set(id, index)));
      const evidenceByComponent = components.map(() => []);
      const unassignedEvidence = [];
      for (const node of evidence) {
        const link = edges.find((edge) => edge.from === node.id || edge.to === node.id);
        const personId = link && personIds.has(link.from) ? link.from : link && personIds.has(link.to) ? link.to : "";
        const component = componentForGroup.get(groupForPerson.get(personId));
        if (component === undefined) unassignedEvidence.push(node);
        else evidenceByComponent[component].push(node);
      }

      let componentOffset = 0;
      components.forEach((component, componentIndex) => {
        const minimumRank = Math.min(...component.map((id) => ranks.get(id)));
        const buckets = new Map();
        for (const id of component) {
          const rank = ranks.get(id) - minimumRank;
          if (!buckets.has(rank)) buckets.set(rank, []);
          buckets.get(rank).push(groupById.get(id));
        }
        const rankNumbers = [...buckets.keys()].sort((left, right) => left - right);
        const order = new Map();
        const updateOrder = () => {
          for (const rank of rankNumbers) buckets.get(rank).forEach((group, index) => order.set(group.id, index));
        };
        const groupSide = (group) => group.members.reduce((sum, member) => sum + side(member.id), 0) / group.members.length;
        const groupBirth = (group) => Math.min(...group.members.map(birth));
        const reorder = (rank, neighbors) => {
          buckets.get(rank).sort((left, right) => {
            const score = (group) => {
              const values = neighbors.get(group.id).filter((id) => order.has(id)).map((id) => order.get(id));
              return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : order.get(group.id);
            };
            return groupSide(left) - groupSide(right) || score(left) - score(right) || groupBirth(left) - groupBirth(right) || left.id.localeCompare(right.id);
          });
          updateOrder();
        };
        for (const row of buckets.values()) row.sort((left, right) => groupSide(left) - groupSide(right) || groupBirth(left) - groupBirth(right) || left.id.localeCompare(right.id));
        updateOrder();
        for (let pass = 0; pass < 4; pass += 1) {
          for (const rank of rankNumbers.slice(1)) reorder(rank, incoming);
          for (const rank of [...rankNumbers].reverse().slice(1)) reorder(rank, outgoing);
        }

        const widthOfGroup = (group) => CARD_WIDTH + (group.members.length - 1) * X_STEP;
        const widthOfRank = (rank) => {
          const row = buckets.get(rank);
          return row.reduce((width, group) => width + widthOfGroup(group), 0) + Math.max(0, row.length - 1) * COLUMN_GAP;
        };
        const rail = evidenceByComponent[componentIndex];
        rail.sort((left, right) => {
          const anchor = (node) => {
            const link = edges.find((edge) => edge.from === node.id || edge.to === node.id);
            const personId = link && personIds.has(link.from) ? link.from : link?.to;
            return groupForPerson.get(personId) || "";
          };
          return anchor(left).localeCompare(anchor(right)) || left.id.localeCompare(right.id);
        });
        const personWidth = Math.max(...rankNumbers.map(widthOfRank));
        const evidenceWidth = rail.length ? CARD_WIDTH + (rail.length - 1) * X_STEP : 0;
        const componentWidth = Math.max(CARD_WIDTH, personWidth, evidenceWidth);
        const groupCenters = new Map();
        for (const rank of [...rankNumbers].reverse()) {
          const row = buckets.get(rank);
          const childCenters = row.flatMap((group) => outgoing.get(group.id).map((child) => groupCenters.get(child)).filter((center) => center !== undefined));
          const desiredCenter = childCenters.length
            ? childCenters.reduce((sum, center) => sum + center, 0) / childCenters.length
            : componentOffset + componentWidth / 2;
          const rowWidth = widthOfRank(rank);
          const minimumStart = componentOffset;
          const maximumStart = componentOffset + componentWidth - rowWidth;
          let cursor = Math.max(minimumStart, Math.min(maximumStart, desiredCenter - rowWidth / 2));
          let remainingWidth = rowWidth;
          for (const group of row) {
            const groupWidth = widthOfGroup(group);
            const anchors = outgoing.get(group.id).map((child) => groupCenters.get(child)).filter((center) => center !== undefined);
            if (anchors.length) {
              const desired = anchors.reduce((sum, center) => sum + center, 0) / anchors.length - groupWidth / 2;
              cursor = Math.max(cursor, Math.min(componentOffset + componentWidth - remainingWidth, desired));
            }
            group.members.forEach((member, index) => {
              positions.set(member.id, { x: cursor + CARD_WIDTH / 2 + index * X_STEP, y: rank * Y_STEP });
            });
            groupCenters.set(group.id, cursor + groupWidth / 2);
            cursor += groupWidth + COLUMN_GAP;
            remainingWidth -= groupWidth + COLUMN_GAP;
          }
        }
        const evidenceY = (Math.max(...rankNumbers) + 1) * Y_STEP;
        let evidenceX = componentOffset + (componentWidth - evidenceWidth) / 2 + CARD_WIDTH / 2;
        for (const node of rail) {
          positions.set(node.id, { x: evidenceX, y: evidenceY });
          evidenceX += X_STEP;
        }
        componentOffset += componentWidth + COMPONENT_GAP;
      });

      for (const node of unassignedEvidence) {
        positions.set(node.id, { x: componentOffset + CARD_WIDTH / 2, y: 0 });
        componentOffset += X_STEP;
      }
    }

    if (positions.size) {
      const values = [...positions.values()];
      const centerX = (Math.min(...values.map((point) => point.x)) + Math.max(...values.map((point) => point.x))) / 2;
      for (const point of values) point.x -= centerX;
    }
    return positions;
  }

  globalThis.KindredLayout = { layout };
})();
