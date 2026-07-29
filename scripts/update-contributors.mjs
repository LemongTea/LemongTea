import { readFile, writeFile } from "node:fs/promises";

const API_URL = "https://api.github.com";

const username =
  process.env.PROFILE_USERNAME ||
  process.env.GITHUB_REPOSITORY_OWNER ||
  "LemongTea";

const githubToken = process.env.GITHUB_TOKEN || "";
const maxCollaborators = Number(process.env.MAX_COLLABORATORS || 12);

const readmePath = new URL("../README.md", import.meta.url);

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "github-profile-collaborators",
  "X-GitHub-Api-Version": "2026-03-10",
};

if (githubToken) {
  headers.Authorization = `Bearer ${githubToken}`;
}

/**
 * Mengambil data dari GitHub REST API.
 */
async function githubRequest(path) {
  const response = await fetch(`${API_URL}${path}`, {
    headers,
  });

  // GitHub dapat mengembalikan 202 ketika data contributor sedang dihitung.
  if (response.status === 202 || response.status === 204) {
    return [];
  }

  if (!response.ok) {
    const errorBody = await response.text();

    throw new Error(
      `GitHub API error ${response.status}: ${errorBody.slice(0, 300)}`,
    );
  }

  return response.json();
}

/**
 * Mengambil seluruh halaman data GitHub API.
 */
async function getPaginated(path, maximumPages = 10) {
  const results = [];

  for (let page = 1; page <= maximumPages; page += 1) {
    const separator = path.includes("?") ? "&" : "?";

    const data = await githubRequest(
      `${path}${separator}per_page=100&page=${page}`,
    );

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    results.push(...data);

    if (data.length < 100) {
      break;
    }
  }

  return results;
}

/**
 * Menjalankan request dengan batas concurrency.
 */
async function mapWithLimit(items, limit, callback) {
  const results = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (true) {
      const index = currentIndex;
      currentIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await callback(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );

  return results;
}

/**
 * Menghindari karakter HTML bermasalah dari nama profil.
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Membagi array menjadi beberapa baris.
 */
function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

/**
 * Membuat tampilan HTML avatar contributor.
 */
function renderCollaborators(collaborators) {
  if (collaborators.length === 0) {
    return [
      '<p align="center">',
      "  <i>Belum ada contributor lain pada repository publik.</i>",
      "</p>",
    ].join("\n");
  }

  const rows = chunkArray(collaborators, 4).map((row) => {
    const cells = row.map((person) => {
      const displayName = escapeHtml(person.displayName);
      const login = escapeHtml(person.login);
      const profileUrl = person.profileUrl;
      const avatarSeparator = person.avatarUrl.includes("?") ? "&" : "?";
      const avatarUrl = `${person.avatarUrl}${avatarSeparator}s=160`;

      return [
        '  <td align="center" width="25%">',
        `    <a href="${profileUrl}">`,
        `      <img src="${avatarUrl}" width="80" height="80" alt="${displayName}" />`,
        "    </a>",
        "    <br />",
        `    <sub><b>${displayName}</b></sub>`,
        "    <br />",
        `    <sub><a href="${profileUrl}">@${login}</a> · ${person.repositoryCount} repo</sub>`,
        "  </td>",
      ].join("\n");
    });

    return ["<tr>", ...cells, "</tr>"].join("\n");
  });

  return [
    '<table align="center">',
    ...rows,
    "</table>",
    "",
    '<p align="center">',
    `  <sub>Updated automatically from public repository contributions of @${escapeHtml(username)}.</sub>`,
    "</p>",
  ].join("\n");
}

/**
 * Program utama.
 */
async function main() {
  console.log(`Scanning public repositories owned by @${username}...`);

  const repositories = await getPaginated(
    `/users/${encodeURIComponent(username)}/repos?type=owner&sort=updated`,
  );

  // Repository fork dan arsip tidak dihitung.
  const eligibleRepositories = repositories.filter(
    (repository) => !repository.fork && !repository.archived,
  );

  console.log(
    `Found ${eligibleRepositories.length} eligible repositories.`,
  );

  const contributorResponses = await mapWithLimit(
    eligibleRepositories,
    5,
    async (repository) => {
      try {
        const contributors = await getPaginated(
          `/repos/${encodeURIComponent(username)}/${encodeURIComponent(
            repository.name,
          )}/contributors?anon=0`,
        );

        return {
          repository: repository.name,
          contributors,
        };
      } catch (error) {
        console.warn(
          `Skipping ${repository.name}: ${error.message}`,
        );

        return {
          repository: repository.name,
          contributors: [],
        };
      }
    },
  );

  const contributorMap = new Map();

  for (const result of contributorResponses) {
    for (const contributor of result.contributors) {
      if (!contributor.login) {
        continue;
      }

      const login = contributor.login;
      const normalizedLogin = login.toLowerCase();

      const isOwner =
        normalizedLogin === username.toLowerCase();

      const isBot =
        contributor.type === "Bot" ||
        normalizedLogin.endsWith("[bot]") ||
        normalizedLogin.endsWith("-bot");

      if (isOwner || isBot) {
        continue;
      }

      const existing = contributorMap.get(normalizedLogin) || {
        login,
        avatarUrl: contributor.avatar_url,
        profileUrl: contributor.html_url,
        contributions: 0,
        repositories: new Set(),
      };

      existing.contributions += Number(
        contributor.contributions || 0,
      );

      existing.repositories.add(result.repository);

      contributorMap.set(normalizedLogin, existing);
    }
  }

  const sortedContributors = [...contributorMap.values()]
    .sort((first, second) => {
      if (second.repositories.size !== first.repositories.size) {
        return second.repositories.size - first.repositories.size;
      }

      return second.contributions - first.contributions;
    })
    .slice(0, maxCollaborators);

  const collaborators = await mapWithLimit(
    sortedContributors,
    5,
    async (contributor) => {
      let profile = null;

      try {
        profile = await githubRequest(
          `/users/${encodeURIComponent(contributor.login)}`,
        );
      } catch (error) {
        console.warn(
          `Could not load profile @${contributor.login}: ${error.message}`,
        );
      }

      return {
        login: contributor.login,
        displayName:
          profile?.name?.trim() || contributor.login,
        avatarUrl:
          profile?.avatar_url || contributor.avatarUrl,
        profileUrl:
          profile?.html_url || contributor.profileUrl,
        repositoryCount: contributor.repositories.size,
        contributions: contributor.contributions,
      };
    },
  );

  const readme = await readFile(readmePath, "utf8");

  const startMarker = "<!-- COLLABORATORS:START -->";
  const endMarker = "<!-- COLLABORATORS:END -->";

  if (
    !readme.includes(startMarker) ||
    !readme.includes(endMarker)
  ) {
    throw new Error(
      "Collaborator markers were not found inside README.md.",
    );
  }

  const collaboratorContent = renderCollaborators(collaborators);

  const generatedBlock = [
    startMarker,
    collaboratorContent,
    endMarker,
  ].join("\n");

  const updatedReadme = readme.replace(
    /<!-- COLLABORATORS:START -->[\s\S]*?<!-- COLLABORATORS:END -->/,
    generatedBlock,
  );

  await writeFile(readmePath, updatedReadme, "utf8");

  console.log(
    `README updated with ${collaborators.length} collaborators.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});