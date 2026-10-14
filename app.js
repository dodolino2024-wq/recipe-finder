const API = {
    mealDB: "https://www.themealdb.com/api/json/v1/1",
    dummyJSON: "https://dummyjson.com/recipes"
};

const PAGE_SIZE = 12;
const REQUEST_TIMEOUT = 12000;

const $ = selector => document.querySelector(selector);

const form = $("#search-form");
const queryInput = $("#ingredient");
const searchMode = $("#search-mode");
const cuisineFilter = $("#cuisine-filter");
const categoryFilter = $("#category-filter");
const dietFilter = $("#diet-filter");
const timeFilter = $("#time-filter");
const ingredientFilter = $("#ingredient-filter");
const excludeFilter = $("#exclude-filter");
const sortFilter = $("#sort-filter");
const results = $("#results");
const status = $("#status");
const resultCount = $("#result-count");
const resultsTitle = $("#results-title");
const resultsSubtitle = $("#results-subtitle");
const loadMoreButton = $("#load-more");
const randomButton = $("#random-button");
const clearButton = $("#clear-button");
const resetFiltersButton = $("#reset-filters");
const recipeDialog = $("#recipe-dialog");
const recipeDetails = $("#recipe-details");
const closeDialogButton = $("#close-dialog");

let allRecipes = [];
let visibleRecipes = [];
let displayedCount = 0;
let searchVersion = 0;
let currentQuery = "";
let currentMode = "name";
let lastSearchHadError = false;

const detailCache = new Map();

function normaliseText(value) {
    return String(value ?? "").trim().toLowerCase();
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function safeURL(value) {
    try {
        const url = new URL(value);
        return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch {
        return "";
    }
}

function setStatus(message, type = "") {
    status.textContent = message;
    status.className = `status ${type}`.trim();
}

async function fetchJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: "application/json" }
        });

        if (!response.ok) {
            throw new Error(`Request failed: ${response.status}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

function normaliseMealDB(meal) {
    if (!meal) return null;

    const ingredients = [];

    for (let index = 1; index <= 20; index++) {
        const ingredient = meal[`strIngredient${index}`]?.trim();
        const measure = meal[`strMeasure${index}`]?.trim();

        if (ingredient) {
            ingredients.push({
                name: ingredient,
                measure: measure || ""
            });
        }
    }

    const instructions = meal.strInstructions || "";
    const name = meal.strMeal || "Untitled recipe";

    return {
        id: `mealdb-${meal.idMeal}`,
        source: "TheMealDB",
        sourceId: meal.idMeal,
        name,
        image: safeURL(meal.strMealThumb),
        cuisine: meal.strArea || "",
        category: meal.strCategory || "",
        ingredients,
        instructions,
        prepTime: null,
        cookTime: null,
        totalTime: null,
        rating: null,
        tags: meal.strTags
            ? meal.strTags.split(",").map(tag => tag.trim()).filter(Boolean)
            : [],
        video: safeURL(meal.strYoutube),
        sourceURL: safeURL(meal.strSource)
    };
}

function normaliseDummy(recipe) {
    if (!recipe) return null;

    const prepTime = Number(recipe.prepTimeMinutes) || 0;
    const cookTime = Number(recipe.cookTimeMinutes) || 0;

    return {
        id: `dummy-${recipe.id}`,
        source: "DummyJSON",
        sourceId: recipe.id,
        name: recipe.name || "Untitled recipe",
        image: safeURL(recipe.image),
        cuisine: recipe.cuisine || "",
        category: Array.isArray(recipe.mealType)
            ? recipe.mealType.join(", ")
            : recipe.mealType || "",
        ingredients: (recipe.ingredients || []).map(name => ({
            name,
            measure: ""
        })),
        instructions: Array.isArray(recipe.instructions)
            ? recipe.instructions.join("\n\n")
            : recipe.instructions || "",
        prepTime,
        cookTime,
        totalTime: prepTime + cookTime || null,
        rating: Number.isFinite(Number(recipe.rating))
            ? Number(recipe.rating)
            : null,
        tags: Array.isArray(recipe.tags) ? recipe.tags : [],
        video: "",
        sourceURL: "",
        servings: recipe.servings || null,
        difficulty: recipe.difficulty || ""
    };
}

async function mealDBNameSearch(query) {
    if (!query) return [];

    const data = await fetchJSON(
        `${API.mealDB}/search.php?s=${encodeURIComponent(query)}`
    );

    return (data.meals || [])
        .map(normaliseMealDB)
        .filter(Boolean);
}

async function mealDBIngredientSearch(ingredient) {
    if (!ingredient) return [];

    const data = await fetchJSON(
        `${API.mealDB}/filter.php?i=${encodeURIComponent(ingredient)}`
    );

    return await loadMealDBDetails(data.meals || []);
}

async function mealDBAreaSearch(area) {
    if (!area) return [];

    const data = await fetchJSON(
        `${API.mealDB}/filter.php?a=${encodeURIComponent(area)}`
    );

    return await loadMealDBDetails(data.meals || []);
}

async function mealDBCategorySearch(category) {
    if (!category) return [];

    const data = await fetchJSON(
        `${API.mealDB}/filter.php?c=${encodeURIComponent(category)}`
    );

    return await loadMealDBDetails(data.meals || []);
}

async function mealDBRandomSearch() {
    const data = await fetchJSON(`${API.mealDB}/random.php`);
    return data.meals?.map(normaliseMealDB).filter(Boolean) || [];
}

async function loadMealDBDetails(meals) {
    const uniqueMeals = [
        ...new Map(
            meals.map(meal => [meal.idMeal, meal])
        ).values()
    ];

    const selected = uniqueMeals.slice(0, 30);

    const results = await Promise.allSettled(
        selected.map(async meal => {
            const cached = detailCache.get(meal.idMeal);

            if (cached) return cached;

            const data = await fetchJSON(
                `${API.mealDB}/lookup.php?i=${encodeURIComponent(meal.idMeal)}`
            );

            const normalised = normaliseMealDB(data.meals?.[0]);

            if (normalised) {
                detailCache.set(meal.idMeal, normalised);
            }

            return normalised;
        })
    );

    return results
        .filter(result => result.status === "fulfilled")
        .map(result => result.value)
        .filter(Boolean);
}

async function dummySearch(query) {
    const url = query
        ? `${API.dummyJSON}/search?q=${encodeURIComponent(query)}&limit=0`
        : `${API.dummyJSON}?limit=0`;

    const data = await fetchJSON(url);

    return (data.recipes || [])
        .map(normaliseDummy)
        .filter(Boolean);
}

async function dummySearchAll() {
    return dummySearch("");
}

function deduplicate(recipes) {
    const seen = new Set();

    return recipes.filter(recipe => {
        const key = normaliseText(recipe.name)
            .replace(/[^a-z0-9]/g, "");

        if (!key || seen.has(key)) return false;

        seen.add(key);
        return true;
    });
}

function getRecipeSearchText(recipe) {
    return normaliseText([
        recipe.name,
        recipe.cuisine,
        recipe.category,
        ...recipe.ingredients.map(item => item.name),
        ...recipe.tags
    ].join(" "));
}

function containsMeat(recipe) {
    const text = getRecipeSearchText(recipe);

    return /\b(beef|pork|chicken|turkey|duck|lamb|goat|venison|bacon|ham|sausage|meat|steak|veal|fish|salmon|tuna|shrimp|prawn|crab|lobster|seafood|anchov|sardine|mackerel|cod|tilapia|trout|oyster|mussel|clam|squid|octopus)\b/i
        .test(text);
}

function isVegetarian(recipe) {
    const text = getRecipeSearchText(recipe);

    const meatWords =
        /\b(beef|pork|chicken|turkey|duck|lamb|goat|venison|bacon|ham|sausage|steak|veal|fish|salmon|tuna|shrimp|prawn|crab|lobster|seafood|anchov|sardine|mackerel|cod|tilapia|trout|oyster|mussel|clam|squid|octopus)\b/i;

    return !meatWords.test(text);
}

function isVegan(recipe) {
    if (!isVegetarian(recipe)) return false;

    const text = getRecipeSearchText(recipe);

    const animalProducts =
        /\b(milk|cream|butter|cheese|yogurt|yoghurt|egg|eggs|honey|gelatin|mayonnaise|whey|casein|parmesan|ghee)\b/i;

    return !animalProducts.test(text);
}

function applyFilters(recipes) {
    const cuisine = normaliseText(cuisineFilter.value);
    const category = normaliseText(categoryFilter.value);
    const diet = dietFilter.value;
    const maxTime = Number(timeFilter.value) || 0;
    const mustInclude = normaliseText(ingredientFilter.value);
    const exclude = normaliseText(excludeFilter.value);

    return recipes.filter(recipe => {
        const searchText = getRecipeSearchText(recipe);
        const cuisineText = normaliseText(recipe.cuisine);
        const categoryText = normaliseText(recipe.category);
        const ingredientText = normaliseText(
            recipe.ingredients.map(item => item.name).join(" ")
        );

        if (cuisine && cuisineText !== cuisine) return false;

        if (
            category &&
            !categoryText.split(",").some(item => normaliseText(item) === category) &&
            !normaliseText(recipe.tags.join(" ")).includes(category)
        ) {
            return false;
        }

        if (diet === "vegetarian" && !isVegetarian(recipe)) return false;
        if (diet === "vegan" && !isVegan(recipe)) return false;
        if (diet === "meat" && !containsMeat(recipe)) return false;

        if (maxTime) {
            if (!recipe.totalTime || recipe.totalTime > maxTime) return false;
        }

        if (mustInclude && !ingredientText.includes(mustInclude)) return false;
        if (exclude && ingredientText.includes(exclude)) return false;

        return Boolean(searchText);
    });
}

function sortRecipes(recipes) {
    const sorted = [...recipes];

    switch (sortFilter.value) {
        case "name":
            sorted.sort((a, b) => a.name.localeCompare(b.name));
            break;

        case "time":
            sorted.sort((a, b) => {
                const aTime = a.totalTime || Number.MAX_SAFE_INTEGER;
                const bTime = b.totalTime || Number.MAX_SAFE_INTEGER;
                return aTime - bTime;
            });
            break;

        case "rating":
            sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
            break;
    }

    return sorted;
}

function recipeCardHTML(recipe) {
    const image = recipe.image || "";
    const time = recipe.totalTime
        ? `⏱ ${recipe.totalTime} min`
        : "⏱ Time unknown";

    const cuisine = recipe.cuisine || "Cuisine unknown";
    const rating = recipe.rating
        ? `★ ${recipe.rating.toFixed(1)}`
        : recipe.source;

    return `
    <article class="recipe-card">
      <div class="recipe-image-wrap">
        ${
        image
            ? `<img class="recipe-image" src="${escapeHTML(image)}" alt="${escapeHTML(recipe.name)}" loading="lazy">`
            : `<div class="recipe-image"></div>`
    }
        <span class="recipe-source">${escapeHTML(recipe.source)}</span>
      </div>

      <div class="recipe-card-body">
        <h3>${escapeHTML(recipe.name)}</h3>

        <div class="recipe-meta">
          <span class="meta-pill">${escapeHTML(time)}</span>
          <span class="meta-pill">${escapeHTML(cuisine)}</span>
          <span class="meta-pill">${escapeHTML(rating)}</span>
        </div>

        <button
          type="button"
          class="button button-secondary"
          data-recipe-id="${escapeHTML(recipe.id)}"
        >
          View recipe →
        </button>
      </div>
    </article>
  `;
}

function renderRecipes() {
    visibleRecipes = sortRecipes(applyFilters(allRecipes));
    displayedCount = Math.min(PAGE_SIZE, visibleRecipes.length);

    results.innerHTML = "";

    if (!visibleRecipes.length) {
        results.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🥲</div>
        <h3>No recipes found</h3>
        <p>Try a different search, remove a filter, or use a broader ingredient.</p>
      </div>
    `;

        resultCount.textContent = "0 recipes";
        loadMoreButton.hidden = true;
        return;
    }

    results.innerHTML = visibleRecipes
        .slice(0, displayedCount)
        .map(recipeCardHTML)
        .join("");

    resultCount.textContent =
        `Showing ${displayedCount} of ${visibleRecipes.length} recipes`;

    loadMoreButton.hidden = displayedCount >= visibleRecipes.length;
}

function loadMore() {
    displayedCount = Math.min(
        displayedCount + PAGE_SIZE,
        visibleRecipes.length
    );

    results.innerHTML = visibleRecipes
        .slice(0, displayedCount)
        .map(recipeCardHTML)
        .join("");

    resultCount.textContent =
        `Showing ${displayedCount} of ${visibleRecipes.length} recipes`;

    loadMoreButton.hidden = displayedCount >= visibleRecipes.length;
}

function getActiveFilters() {
    return Boolean(
        cuisineFilter.value ||
        categoryFilter.value ||
        dietFilter.value ||
        timeFilter.value ||
        ingredientFilter.value.trim() ||
        excludeFilter.value.trim()
    );
}

async function searchRecipes({ query, mode } = {}) {
    const version = ++searchVersion;

    currentQuery = (query ?? queryInput.value).trim();
    currentMode = mode ?? searchMode.value;

    resultsTitle.textContent = currentQuery
        ? `Results for “${currentQuery}”`
        : "Explore recipes";

    resultsSubtitle.textContent =
        "Searching across multiple free recipe sources.";

    results.innerHTML = "";
    resultCount.textContent = "";
    loadMoreButton.hidden = true;
    setStatus("Finding recipes…");

    const jobs = [];

    if (currentMode === "ingredient" && currentQuery) {
        jobs.push(mealDBIngredientSearch(currentQuery));
        jobs.push(dummySearch(currentQuery));
    } else {
        jobs.push(dummySearch(currentQuery));

        if (currentQuery) {
            jobs.push(mealDBNameSearch(currentQuery));
        }
    }

    if (cuisineFilter.value) {
        jobs.push(mealDBAreaSearch(cuisineFilter.value));
    }

    if (categoryFilter.value) {
        jobs.push(mealDBCategorySearch(categoryFilter.value));
    }

    if (!currentQuery && !cuisineFilter.value && !categoryFilter.value) {
        jobs.push(mealDBRandomSearch());
    }

    const settled = await Promise.allSettled(jobs);

    if (version !== searchVersion) return;

    const fulfilled = settled
        .filter(result => result.status === "fulfilled")
        .flatMap(result => result.value);

    const failedCount = settled.filter(
        result => result.status === "rejected"
    ).length;

    lastSearchHadError = failedCount > 0;

    allRecipes = deduplicate(fulfilled);

    renderRecipes();

    if (!allRecipes.length && failedCount === jobs.length) {
        setStatus(
            "Recipe sources could not be reached. Check your internet connection and try again.",
            "error"
        );
    } else if (!allRecipes.length) {
        setStatus(
            "No matching recipes. Try a different term or remove some filters."
        );
    } else if (failedCount > 0) {
        setStatus(
            `Found recipes, but ${failedCount} source request(s) failed. Some results may be missing.`,
            "error"
        );
    } else {
        setStatus(
            `Found ${visibleRecipes.length} matching recipe${visibleRecipes.length === 1 ? "" : "s"}.`,
            "success"
        );
    }

    resultsSubtitle.textContent =
        `${allRecipes.length} unique recipes collected from available sources.`;
}

async function showRecipe(recipeId) {
    const recipe = allRecipes.find(item => item.id === recipeId);

    if (!recipe) return;

    recipeDetails.innerHTML = `
    <div class="dialog-content">
      <p class="eyebrow">RECIPE DETAILS</p>
      <h2>${escapeHTML(recipe.name)}</h2>
      <p>Loading ingredients and instructions…</p>
    </div>
  `;

    if (!recipeDialog.open) recipeDialog.showModal();

    let fullRecipe = recipe;

    if (recipe.source === "TheMealDB") {
        try {
            const cached = detailCache.get(String(recipe.sourceId));

            if (cached) {
                fullRecipe = cached;
            } else {
                const data = await fetchJSON(
                    `${API.mealDB}/lookup.php?i=${encodeURIComponent(recipe.sourceId)}`
                );

                fullRecipe = normaliseMealDB(data.meals?.[0]) || recipe;
                detailCache.set(String(recipe.sourceId), fullRecipe);
            }
        } catch {
            fullRecipe = recipe;
        }
    }

    if (!recipeDialog.open) return;

    const image = fullRecipe.image
        ? `<img class="dialog-image" src="${escapeHTML(fullRecipe.image)}" alt="${escapeHTML(fullRecipe.name)}">`
        : "";

    const ingredients = fullRecipe.ingredients.length
        ? fullRecipe.ingredients.map(item => {
            const line = [item.measure, item.name].filter(Boolean).join(" ");
            return `<li>${escapeHTML(line)}</li>`;
        }).join("")
        : "<li>Ingredient list unavailable.</li>";

    const instructions = fullRecipe.instructions
        ? fullRecipe.instructions
            .split(/\n+/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => `<p>${escapeHTML(line)}</p>`)
            .join("")
        : "<p>Instructions are unavailable for this recipe.</p>";

    const links = [
        fullRecipe.sourceURL
            ? `<a href="${escapeHTML(fullRecipe.sourceURL)}" target="_blank" rel="noopener noreferrer">Original recipe ↗</a>`
            : "",
        fullRecipe.video
            ? `<a href="${escapeHTML(fullRecipe.video)}" target="_blank" rel="noopener noreferrer">Watch video ↗</a>`
            : ""
    ].filter(Boolean).join("");

    recipeDetails.innerHTML = `
    ${image}
    <div class="dialog-content">
      <p class="eyebrow">${escapeHTML(fullRecipe.source)}</p>
      <h2>${escapeHTML(fullRecipe.name)}</h2>

      <div class="recipe-meta">
        ${fullRecipe.cuisine
        ? `<span class="meta-pill">${escapeHTML(fullRecipe.cuisine)}</span>`
        : ""}
        ${fullRecipe.category
        ? `<span class="meta-pill">${escapeHTML(fullRecipe.category)}</span>`
        : ""}
        ${fullRecipe.totalTime
        ? `<span class="meta-pill">⏱ ${fullRecipe.totalTime} min</span>`
        : ""}
        ${fullRecipe.rating
        ? `<span class="meta-pill">★ ${fullRecipe.rating.toFixed(1)}</span>`
        : ""}
      </div>

      <h3>Ingredients</h3>
      <ul class="ingredient-list">${ingredients}</ul>

      <h3>Instructions</h3>
      ${instructions}

      ${links ? `<div class="dialog-links">${links}</div>` : ""}
    </div>
  `;
}

async function surpriseMe() {
    randomButton.disabled = true;
    setStatus("Finding something delicious…");

    try {
        const results = await Promise.allSettled([
            mealDBRandomSearch(),
            dummySearchAll()
        ]);

        const candidates = deduplicate(
            results
                .filter(result => result.status === "fulfilled")
                .flatMap(result => result.value)
        );

        if (!candidates.length) {
            setStatus("Could not load a random recipe. Try again.", "error");
            return;
        }

        const recipe = candidates[
            Math.floor(Math.random() * candidates.length)
            ];

        allRecipes = deduplicate([...allRecipes, recipe]);
        await showRecipe(recipe.id);
        setStatus("Surprise recipe ready!", "success");
    } catch {
        setStatus("Could not load a random recipe. Try again.", "error");
    } finally {
        randomButton.disabled = false;
    }
}

function resetFilters() {
    cuisineFilter.value = "";
    categoryFilter.value = "";
    dietFilter.value = "";
    timeFilter.value = "";
    ingredientFilter.value = "";
    excludeFilter.value = "";
    sortFilter.value = "relevance";
}

function clearSearch() {
    queryInput.value = "";
    searchMode.value = "name";
    resetFilters();
    searchRecipes({ query: "", mode: "name" });
}

form.addEventListener("submit", event => {
    event.preventDefault();
    searchRecipes();
});

loadMoreButton.addEventListener("click", loadMore);

randomButton.addEventListener("click", surpriseMe);

clearButton.addEventListener("click", clearSearch);

resetFiltersButton.addEventListener("click", () => {
    resetFilters();
    searchRecipes();
});

[
    cuisineFilter,
    categoryFilter,
    dietFilter,
    timeFilter,
    ingredientFilter,
    excludeFilter,
    sortFilter
].forEach(element => {
    element.addEventListener("change", () => {
        renderRecipes();

        if (element === cuisineFilter || element === categoryFilter) {
            searchRecipes();
        } else {
            const count = visibleRecipes.length;
            setStatus(
                `${count} matching recipe${count === 1 ? "" : "s"} after filtering.`,
                count ? "success" : ""
            );
        }
    });
});

document.querySelectorAll(".quick-query").forEach(button => {
    button.addEventListener("click", () => {
        queryInput.value = button.dataset.query || "";
        searchMode.value = "name";
        searchRecipes();
    });
});

results.addEventListener("click", event => {
    const button = event.target.closest("[data-recipe-id]");
    if (!button) return;

    showRecipe(button.dataset.recipeId);
});

closeDialogButton.addEventListener("click", () => {
    recipeDialog.close();
});

recipeDialog.addEventListener("click", event => {
    if (event.target === recipeDialog) {
        recipeDialog.close();
    }
});

recipeDialog.addEventListener("close", () => {
    recipeDetails.innerHTML = "";
});

searchRecipes({ query: "", mode: "name" });