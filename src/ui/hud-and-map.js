import { SHRINES } from '../world/serpent-spline.js';
import { HERO_ROSTER, GRIMOIRE_SPELLS, CHAPTER_REALMS } from '../combat/combat-engine.js';
import { DIFFICULTY_MODES, difficultyEffectLines, getDifficultyProfile } from '../combat/difficulty.js';
import { WEAPON_CATALOG } from '../anim/puppet-store.js';

export class SoulslikeHUDAndMap {
  constructor({ topology, world, combat, onTeleportShrine, onCycleHero, onCycleWeapon, onCycleSpell }) {
    this.topology = topology;
    this.world = world;
    this.combat = combat;
    this.onTeleportShrine = onTeleportShrine;
    this.onCycleHero = onCycleHero;
    this.onCycleWeapon = onCycleWeapon;
    this.onCycleSpell = onCycleSpell;

    this.mapExpanded = false;
    this.escapeExpanded = false;
    this.delayedPlayerHpPct = 100;
    this.delayedBossHpPct = 100;
    this.lastZoneId = null;
    this.zoneBannerTimer = 0;
    this.calloutTimer = 0;
    this.mapRefreshTimer = 0;

    this._setupCrests();
    this._cacheDOM();
    this._bindEvents();
    this._setupDifficultySelector();
  }

  _setupCrests() {
    const deck = document.getElementById('hud-combat-deck');
    const atb = deck?.querySelector('[data-stack-group="atb"] .stack-items');
    const limit = atb?.querySelector('[data-combat-act="limit"]');
    if (limit) {
      const fourth = limit.cloneNode(true);
      fourth.className = 'skill-btn atb';
      fourth.dataset.combatAct = 'skill4';
      fourth.dataset.tip = 'Arcane Surge · 1 Focus [4]';
      fourth.querySelector('.sk-key').textContent = '4';
      atb.replaceChild(fourth, limit);
      limit.className = 'hud-limit-action';
      deck.append(limit);
      this.elLimitAction = limit;
    }
    document.querySelectorAll('.sym-stack').forEach(stack => {
      stack.classList.toggle('collapsed', stack.dataset.stackGroup !== 'atb');
      const toggle = stack.querySelector('[data-stack-toggle]');
      toggle.setAttribute('aria-expanded', String(!stack.classList.contains('collapsed')));
      toggle.setAttribute('aria-label', `${stack.dataset.stackGroup} actions`);
    });
    const utility = document.querySelector('.vessel-crest-strip');
    if (utility) {
      document.getElementById('hud-bottom-left').append(document.getElementById('btn-mend-gourd'));
      utility.classList.add('collapsed');
      const hub = document.createElement('button');
      hub.type = 'button'; hub.className = 'crest-hub';
      hub.setAttribute('aria-label', 'Expand vessel and loadout cross');
      hub.setAttribute('aria-expanded', 'false');
      hub.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg>';
      hub.addEventListener('click', () => {
        const collapsed = utility.classList.toggle('collapsed');
        hub.setAttribute('aria-expanded', String(!collapsed));
      });
      utility.append(hub);
    }
    document.querySelectorAll('[data-tip]').forEach(button => {
      button.setAttribute('aria-label', button.dataset.tip);
      button.title = button.dataset.tip;
    });
  }

  releaseActionCursor() {
    this.cursorMode = true;
    if (document.pointerLockElement) document.exitPointerLock();
    document.querySelector('[data-stack-toggle="atb"]')?.focus();
  }

  _cacheDOM() {
    this.elBossContainer = document.getElementById('hud-boss-container');
    this.elBossName = document.getElementById('hud-boss-name');
    this.elBossSubtitle = document.getElementById('hud-boss-subtitle');
    this.elBossPhase = document.getElementById('hud-boss-phase');
    this.elBossStance = document.getElementById('hud-boss-stance');
    this.elBossHpFill = document.getElementById('hud-boss-hp-fill');
    this.elBossHpTrail = document.getElementById('hud-boss-hp-trail');
    this.elBossPoiseFill = document.getElementById('hud-boss-poise-fill');

    this.elPlayerHpFill = document.getElementById('hud-player-hp-fill');
    this.elPlayerHpTrail = document.getElementById('hud-player-hp-trail');
    this.elPlayerHpText = document.getElementById('hud-player-hp-text');
    this.elPlayerStamFill = document.getElementById('hud-player-stam-fill');
    this.elLastMove = document.getElementById('hud-last-move');
    this.elFocusSegments = document.getElementById('hud-focus-segments');
    this.elFocusPct = document.getElementById('hud-focus-pct');
    this.elStanceBtn = document.getElementById('btn-stance-mode');
    this.elStanceText = document.getElementById('hud-stance-text');
    this.elFlowBadge = document.getElementById('hud-flow-badge');
    this.elLimitFill = document.getElementById('hud-limit-fill');
    this.elLimitText = document.getElementById('hud-limit-text');
    this.elGourdCount = document.getElementById('hud-gourd-count');
    this.elSpiritBadge = document.getElementById('hud-spirit-badge');
    this.elWeaponName = document.getElementById('hud-weapon-name');
    this.elHeroName = document.getElementById('hud-hero-name');
    this.elSpellName = document.getElementById('hud-spell-name');

    this.elCallout = document.getElementById('hud-combat-callout');
    this.elCalloutTitle = document.getElementById('hud-callout-title');
    this.elCalloutSub = document.getElementById('hud-callout-sub');

    this.elZoneBanner = document.getElementById('hud-zone-banner');
    this.elZoneTitle = document.getElementById('hud-zone-title');
    this.elZoneSubtitle = document.getElementById('hud-zone-subtitle');

    this.elPrompt = document.getElementById('hud-interact-prompt');
    this.elLockReticle = document.getElementById('hud-lock-reticle');

    this.elMiniMapCanvas = document.getElementById('hud-minimap-canvas');
    this.miniCtx = this.elMiniMapCanvas ? this.elMiniMapCanvas.getContext('2d') : null;
    this.elZoneIndicator = document.getElementById('hud-minimap-zone');
    this.elSpinePct = document.getElementById('hud-minimap-pct');

    this.elFullMapModal = document.getElementById('hud-fullmap-modal');
    this.elFullMapCanvas = document.getElementById('hud-fullmap-canvas');
    this.fullCtx = this.elFullMapCanvas ? this.elFullMapCanvas.getContext('2d') : null;
    this.elShrineList = document.getElementById('hud-shrine-list');

    this.elEscapeModal = document.getElementById('hud-escape-modal');
    this.elEscHeroList = document.getElementById('esc-hero-list');
    this.elEscWeaponList = document.getElementById('esc-weapon-list');
    this.elEscSpellList = document.getElementById('esc-spell-list');
    this.elEscDifficultyList = document.getElementById('esc-difficulty-list');
    this.elEscDifficultySummary = document.getElementById('esc-difficulty-summary');
    this.elDifficultyBadge = document.getElementById('hud-difficulty-badge');
  }

  _setupDifficultySelector() {
    if (!this.elEscDifficultyList) return;
    this.elEscDifficultyList.innerHTML = '';
    DIFFICULTY_MODES.forEach((mode) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'sel-pill';
      pill.dataset.difficultyId = mode.id;
      pill.title = `${mode.tagline} ${mode.summary}`;

      const name = document.createElement('span');
      name.textContent = mode.name;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = mode.tag;
      pill.append(name, tag);

      pill.addEventListener('click', () => {
        this.combat.setDifficulty?.(mode.id);
        this._syncDifficultyUI();
      });
      this.elEscDifficultyList.appendChild(pill);
    });
    this._syncDifficultyUI();
  }

  _syncDifficultyUI() {
    const profile = getDifficultyProfile(this.combat.getDifficultyId?.() || 'expert');
    if (this.elEscDifficultyList) {
      this.elEscDifficultyList.querySelectorAll('[data-difficulty-id]').forEach((pill) => {
        const active = pill.dataset.difficultyId === profile.id;
        pill.classList.toggle('active', active);
        pill.setAttribute('aria-pressed', String(active));
      });
    }
    if (this.elEscDifficultySummary) {
      this.elEscDifficultySummary.innerHTML =
        `<strong>${profile.name}</strong> — ${profile.summary}` +
        `<span class="esc-difficulty-mods">${difficultyEffectLines(profile.id).join(' · ')}</span>`;
    }
    if (this.elDifficultyBadge) {
      this.elDifficultyBadge.textContent = profile.name.toUpperCase();
      this.elDifficultyBadge.dataset.difficulty = profile.id;
      this.elDifficultyBadge.title = `Trial difficulty: ${profile.name} — open Sanctuary [ESC] to change`;
    }
  }

  _bindEvents() {
    const btnMapToggle = document.getElementById('btn-toggle-map');
    if (btnMapToggle) {
      btnMapToggle.addEventListener('click', () => this.toggleFullMap());
    }
    if (this.elMiniMapCanvas) {
      this.elMiniMapCanvas.addEventListener('click', () => this.toggleFullMap());
    }
    const btnCloseMap = document.getElementById('btn-close-map');
    if (btnCloseMap) {
      btnCloseMap.addEventListener('click', () => this.toggleFullMap(false));
    }

    const btnOpenEsc = document.getElementById('btn-open-escape');
    if (btnOpenEsc) {
      btnOpenEsc.addEventListener('click', () => this.toggleEscapeMenu());
    }
    const btnCloseEsc = document.getElementById('btn-close-escape');
    if (btnCloseEsc) {
      btnCloseEsc.addEventListener('click', () => this.toggleEscapeMenu(false));
    }
    if (this.elDifficultyBadge) {
      this.elDifficultyBadge.addEventListener('click', () => {
        this.elDifficultyBadge.blur();
        this.toggleEscapeMenu(true);
      });
    }

    const btnMendGourd = document.getElementById('btn-mend-gourd');
    if (btnMendGourd) {
      btnMendGourd.addEventListener('click', () => {
        this.combat.triggerHealGourd();
      });
    }

    const btnCycleWeapon = document.getElementById('btn-cycle-weapon');
    if (btnCycleWeapon) {
      btnCycleWeapon.addEventListener('click', () => {
        if (this.onCycleWeapon) this.onCycleWeapon();
      });
    }
    const btnCycleHero = document.getElementById('btn-cycle-hero');
    if (btnCycleHero) {
      btnCycleHero.addEventListener('click', () => {
        if (this.onCycleHero) this.onCycleHero();
      });
    }
    const btnCycleSpell = document.getElementById('btn-cycle-spell');
    if (btnCycleSpell) {
      btnCycleSpell.addEventListener('click', () => {
        if (this.onCycleSpell) this.onCycleSpell();
      });
    }
    if (this.elStanceBtn) {
      this.elStanceBtn.addEventListener('click', () => {
        this.combat.toggleStanceMode();
      });
    }

    // Bind Collapsible & Expandable Thematic Symbolic Stacks
    const stackToggles = document.querySelectorAll('[data-stack-toggle]');
    stackToggles.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const stackEl = btn.closest('.sym-stack');
        if (!stackEl) return;
        const expand = stackEl.classList.contains('collapsed');
        document.querySelectorAll('.sym-stack').forEach(stack => {
          const open = stack === stackEl && expand;
          stack.classList.toggle('collapsed', !open);
          stack.querySelector('[data-stack-toggle]').setAttribute('aria-expanded', String(open));
        });
      });
    });

    // Bind interactive Combat Action Deck buttons
    const deckButtons = document.querySelectorAll('[data-combat-act]');
    deckButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.getAttribute('data-combat-act');
        if (act === 'dash') this.combat.triggerSprintDashAttack(false);
        else if (act === 'rising') this.combat.triggerRisingUndercut();
        else if (act === 'thrust') this.combat.triggerPiercingThrust();
        else if (act === 'kick') this.combat.triggerGuardBreakKick();
        else if (act === 'backhand') this.combat.triggerBackhandSlash();
        else if (act === 'leap') this.combat.triggerLeapingSmash();
        else if (act === 'bolt') this.combat.triggerArcaneSpellCombo();
        else if (act === 'grimoire') this.combat.triggerGrimoireSpell();
        else if (act === 'skill1') this.combat.triggerWeaponSkill(1);
        else if (act === 'skill2') this.combat.triggerWeaponSkill(2);
        else if (act === 'skill3') this.combat.triggerWeaponSkill(3);
        else if (act === 'skill4') this.combat.triggerWeaponSkill(4);
        else if (act === 'limit') this.combat.triggerLimitBreak();
      });
    });

    // Populate Escape Menu Selectors: Chapter Realms, Playable Vessels, Weapons, Spells
    if (this.elEscHeroList) {
      const heroBlock = this.elEscHeroList.parentElement;
      if (heroBlock && heroBlock.parentElement && !document.getElementById('esc-chapter-list')) {
        const chBlock = document.createElement('div');
        chBlock.className = heroBlock.className;
        chBlock.innerHTML = `<div class="esc-sec-title">CAMPAIGN REALMS [F6] — MULTI-LEVEL PROGRESSION</div><div id="esc-chapter-list" class="esc-pill-grid"></div>`;
        heroBlock.parentElement.insertBefore(chBlock, heroBlock);
        this.elEscChapterList = chBlock.querySelector('#esc-chapter-list');
        CHAPTER_REALMS.forEach((ch) => {
          const pill = document.createElement('button');
          pill.className = 'sel-pill';
          pill.dataset.chapterNum = String(ch.chapter);
          pill.textContent = `Ch.${ch.chapter}: ${ch.name}`;
          pill.title = `${ch.subtitle} (${ch.diffHp}x HP / ${ch.diffDmg}x DMG)`;
          pill.addEventListener('click', () => {
            this.combat.selectChapter?.(ch.chapter);
          });
          this.elEscChapterList.appendChild(pill);
        });
      }

      this.elEscHeroList.innerHTML = '';
      HERO_ROSTER.forEach((h) => {
        const pill = document.createElement('button');
        pill.className = 'sel-pill';
        pill.dataset.heroId = h.id;
        pill.textContent = h.shortName || h.name;
        pill.title = h.name;
        pill.addEventListener('click', () => {
          this.combat.selectHero(h.id);
        });
        this.elEscHeroList.appendChild(pill);
      });
    }

    if (this.elEscWeaponList) {
      this.elEscWeaponList.innerHTML = '';
      Object.values(WEAPON_CATALOG).forEach((w) => {
        const pill = document.createElement('button');
        pill.className = 'sel-pill';
        pill.dataset.weaponId = w.id;
        pill.textContent = w.name;
        pill.addEventListener('click', () => {
          this.combat.selectWeapon(w.id);
        });
        this.elEscWeaponList.appendChild(pill);
      });
    }

    if (this.elEscSpellList) {
      this.elEscSpellList.innerHTML = '';
      GRIMOIRE_SPELLS.forEach((sp, idx) => {
        const pill = document.createElement('button');
        pill.className = 'sel-pill';
        pill.dataset.spellIdx = String(idx);
        pill.textContent = sp.name;
        pill.title = sp.desc;
        pill.addEventListener('click', () => {
          this.combat.selectGrimoireSpell(idx);
        });
        this.elEscSpellList.appendChild(pill);
      });
    }

    // Build clickable Shrine fast-travel buttons in the full map modal
    if (this.elShrineList) {
      this.elShrineList.innerHTML = '';
      SHRINES.forEach((shrine) => {
        const btn = document.createElement('button');
        btn.className = 'shrine-tp-btn';
        btn.dataset.shrineZone = shrine.zone;
        btn.innerHTML = `
          <span class="shrine-key">[F${shrine.zone}]</span>
          <div class="shrine-meta">
            <div class="shrine-title">${shrine.name}</div>
            <div class="shrine-sub">Zone ${shrine.zone} • Spine t = ${(shrine.t * 100).toFixed(0)}%</div>
          </div>
        `;
        btn.addEventListener('click', () => {
          if (this.onTeleportShrine) this.onTeleportShrine(shrine.zone);
          this.toggleFullMap(false);
        });
        this.elShrineList.appendChild(btn);
      });
    }

    // Allow clicking directly on full-map shrines
    if (this.elFullMapCanvas) {
      this.elFullMapCanvas.addEventListener('click', (e) => {
        const rect = this.elFullMapCanvas.getBoundingClientRect();
        const cx = ((e.clientX - rect.left) / rect.width) * this.elFullMapCanvas.width;
        const cy = ((e.clientY - rect.top) / rect.height) * this.elFullMapCanvas.height;
        const hitZone = this._hitTestShrineOnCanvas(
          cx,
          cy,
          this.elFullMapCanvas.width,
          this.elFullMapCanvas.height
        );
        if (hitZone !== -1 && this.onTeleportShrine) {
          this.onTeleportShrine(hitZone);
          this.toggleFullMap(false);
        }
      });
    }
  }

  toggleFullMap(force = null) {
    this.mapExpanded = force !== null ? force : !this.mapExpanded;
    if (this.mapExpanded) {
      this.escapeExpanded = false;
      if (this.elEscapeModal) this.elEscapeModal.classList.add('hidden');
    }
    if (this.elFullMapModal) {
      this.elFullMapModal.classList.toggle('hidden', !this.mapExpanded);
    }
    if (this.mapExpanded && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  toggleEscapeMenu(force = null) {
    this.escapeExpanded = force !== null ? force : !this.escapeExpanded;
    if (this.escapeExpanded) {
      this.mapExpanded = false;
      if (this.elFullMapModal) this.elFullMapModal.classList.add('hidden');
      this._syncDifficultyUI();
    }
    if (this.elEscapeModal) {
      this.elEscapeModal.classList.toggle('hidden', !this.escapeExpanded);
    }
    if (this.escapeExpanded && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  showBanner(text, color = '#d7c19a', subtext = '') {
    // Fold transient combat callouts into the bottom-left corner micro-status
    const concise = String(text || '')
      .replace(/\s*—.*$/, '')
      .replace(/\s*\(.*?\)/g, '')
      .trim();
    this.cornerCalloutText = concise.slice(0, 36);
    this.cornerCalloutColor = color === '#ff1e1e' || color === '#ff3b30' ? '#e8836b' : color === '#ffd700' ? '#ffd98a' : '#8ab8c9';
    this.calloutTimer = 2.0;
    if (!this.elCallout) return;
    this.elCalloutTitle.textContent = this.cornerCalloutText;
    this.elCalloutTitle.style.color = this.cornerCalloutColor;
    this.elCalloutSub.textContent = subtext;
  }

  triggerZoneBanner(zone) {
    if (!zone) return;
    this.cornerCalloutText = String(zone.name || '').toUpperCase().slice(0, 36);
    this.cornerCalloutColor = '#d7c19a';
    this.zoneBannerTimer = 2.8;
    if (!this.elZoneBanner) return;
    this.elZoneTitle.textContent = zone.name;
    this.elZoneSubtitle.textContent = zone.subtitle;
  }

  update(dt, camera, frameState = {}) {
    const p = this.combat.player;
    if (!p) return;

    const playerLoc = frameState.playerLoc || this.topology.locateWorldPoint(p.pos);
    const spineT = playerLoc.isBranch ? 0.225 : playerLoc.t;

    // 1. Check Zone transition for corner micro-label
    const zone = this.topology.getZoneForT(spineT);
    if (zone && zone.id !== this.lastZoneId) {
      this.lastZoneId = zone.id;
      this.triggerZoneBanner(zone);
    }

    if (this.zoneBannerTimer > 0) {
      this.zoneBannerTimer -= dt;
      if (this.zoneBannerTimer <= 0 && this.elZoneBanner) {
        this.elZoneBanner.classList.add('hidden');
      }
    }

    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      if (this.calloutTimer <= 0 && this.elCallout) {
        this.elCallout.classList.add('hidden');
      }
    }

    // 2. Player HP & Stamina bars
    const hpPct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
    this.delayedPlayerHpPct += (hpPct - this.delayedPlayerHpPct) * Math.min(1, dt * 4.5);
    if (this.elPlayerHpFill) this.elPlayerHpFill.style.width = `${hpPct.toFixed(1)}%`;
    if (this.elPlayerHpTrail) this.elPlayerHpTrail.style.width = `${this.delayedPlayerHpPct.toFixed(1)}%`;
    if (this.elPlayerHpText) this.elPlayerHpText.textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;

    const stamPct = Math.max(0, Math.min(100, (p.stamina / p.maxStamina) * 100));
    if (this.elPlayerStamFill) this.elPlayerStamFill.style.width = `${stamPct.toFixed(1)}%`;
    if (this.elLastMove) {
      if ((this.calloutTimer > 0 || this.zoneBannerTimer > 0) && this.cornerCalloutText) {
        this.elLastMove.textContent = this.cornerCalloutText.toUpperCase();
        this.elLastMove.style.color = this.cornerCalloutColor || '#8ab8c9';
      } else {
        this.elLastMove.textContent = (p.lastMoveName || 'READY').toUpperCase();
        this.elLastMove.style.color = '#8ab8c9';
      }
    }

    // 3. Focus Bar Segments (3 or 4 ATB/Focus segments)
    const maxFocusBars = Math.round(p.maxFocus || 3);
    const wholeFocus = Math.floor(p.focus || 0);
    const fracFocus = (p.focus || 0) - wholeFocus;

    if (this.elFocusSegments) {
      if (this.elFocusSegments.children.length !== maxFocusBars) {
        this.elFocusSegments.innerHTML = '';
        for (let i = 0; i < maxFocusBars; i++) {
          const seg = document.createElement('div');
          seg.className = 'focus-seg';
          const fill = document.createElement('div');
          fill.className = 'focus-seg-fill';
          seg.appendChild(fill);
          this.elFocusSegments.appendChild(seg);
        }
      }
      for (let i = 0; i < maxFocusBars; i++) {
        const seg = this.elFocusSegments.children[i];
        const fill = seg.firstElementChild;
        if (i < wholeFocus) {
          seg.classList.add('charged');
          fill.style.width = '100%';
        } else if (i === wholeFocus) {
          seg.classList.remove('charged');
          fill.style.width = `${(fracFocus * 100).toFixed(0)}%`;
        } else {
          seg.classList.remove('charged');
          fill.style.width = '0%';
        }
      }
    }
    if (this.elFocusPct) {
      this.elFocusPct.textContent = `${wholeFocus}/${maxFocusBars}`;
    }

    // 3b. FF7R Stance Mode, Prismatic Flow Counter & Limit Gauge
    if (this.elStanceBtn) {
      const isPunisher = p.stanceMode === 'punisher';
      if (this.elStanceText) {
        this.elStanceText.textContent = isPunisher ? 'PUN' : 'OPR';
      }
      this.elStanceBtn.classList.toggle('punisher', isPunisher);
    }
    if (this.elFlowBadge) {
      this.elFlowBadge.textContent = `FLOW ${p.flowCount || 0}/3`;
    }
    const limitPct = Math.max(0, Math.min(100, p.limitGauge || 0));
    if (this.elLimitFill) {
      this.elLimitFill.style.width = `${limitPct.toFixed(0)}%`;
    }
    if (this.elLimitText) {
      this.elLimitText.textContent =
        limitPct >= 100 ? 'MAX' : `${Math.floor(limitPct)}%`;
    }

    // 4. Gourd, Weapon, Hero & Spirit Buff
    if (this.elGourdCount) {
      this.elGourdCount.textContent = `${p.gourds}`;
    }
    if (this.elSpiritBadge) {
      this.elSpiritBadge.classList.toggle('hidden', !p.elderSpiritBuff);
    }
    const weaponDef = WEAPON_CATALOG[p.weaponId];
    if (this.elWeaponName && weaponDef) {
      this.elWeaponName.textContent = weaponDef.name;
    }
    const heroDef = HERO_ROSTER[p.heroIndex];
    if (this.elHeroName && heroDef) {
      this.elHeroName.textContent = heroDef.shortName || heroDef.name;
    }
    const spellDef = this.combat.getSelectedSpell ? this.combat.getSelectedSpell() : null;
    if (this.elSpellName && spellDef) {
      this.elSpellName.textContent = spellDef.name;
      this.elSpellName.style.color = spellDef.color || '#9fffe6';
    }

    // Highlight active Escape Menu Pills
    if (this.escapeExpanded && this.elEscChapterList) {
      this.elEscChapterList.querySelectorAll('.sel-pill').forEach((el) => {
        el.classList.toggle('active', Number(el.dataset.chapterNum) === (this.combat.chapterIndex || 1));
      });
    }
    if (this.escapeExpanded && this.elEscHeroList && heroDef) {
      this.elEscHeroList.querySelectorAll('.sel-pill').forEach((el) => {
        el.classList.toggle('active', el.dataset.heroId === heroDef.id);
      });
    }
    if (this.escapeExpanded && this.elEscWeaponList) {
      this.elEscWeaponList.querySelectorAll('.sel-pill').forEach((el) => {
        el.classList.toggle('active', el.dataset.weaponId === p.weaponId);
      });
    }
    if (this.escapeExpanded && this.elEscSpellList) {
      this.elEscSpellList.querySelectorAll('.sel-pill').forEach((el) => {
        el.classList.toggle('active', Number(el.dataset.spellIdx) === p.selectedSpellIndex);
      });
    }

    // 5. Boss / Mini-Boss Top Bar
    const activeBoss = frameState.activeBoss || this.combat.getActiveBoss();
    if (activeBoss && this.elBossContainer) {
      this.elBossContainer.classList.remove('hidden');
      this.elBossName.textContent = activeBoss.name;
      this.elBossSubtitle.textContent = activeBoss.title || '';
      this.elBossPhase.textContent = `PHASE ${activeBoss.phase === 2 ? 'II' : 'I'}`;
      const isBroken = activeBoss.state === 'stagger';
      const isPressured = activeBoss.pressuredTimer > 0;
      this.elBossStance.textContent = isBroken
        ? 'POSTURE BROKEN — LMB RIPOSTE!'
        : isPressured
        ? 'PRESSURED — STAGGER VULNERABLE!'
        : `STANCE: ${(activeBoss.stance || 'highGuard').toUpperCase()}`;
      this.elBossStance.classList.toggle('broken', isBroken || isPressured);

      const bHpPct = Math.max(0, Math.min(100, (activeBoss.hp / activeBoss.maxHp) * 100));
      this.delayedBossHpPct += (bHpPct - this.delayedBossHpPct) * Math.min(1, dt * 4.0);
      this.elBossHpFill.style.width = `${bHpPct.toFixed(1)}%`;
      this.elBossHpTrail.style.width = `${this.delayedBossHpPct.toFixed(1)}%`;

      const bPoisePct = Math.max(0, Math.min(100, (activeBoss.poise / activeBoss.maxPoise) * 100));
      this.elBossPoiseFill.style.width = `${bPoisePct.toFixed(1)}%`;
    } else if (this.elBossContainer) {
      this.elBossContainer.classList.add('hidden');
    }

    // 6. Shrine or Ascension Portal Interaction Prompt
    const nearShrine = frameState.nearestShrine || this.combat.getNearestShrine();
    const portalPos = this.world?.ascensionPortal?.pos;
    const nearPortal = portalPos && p.pos.distanceTo(portalPos) < 8.5;
    if (nearPortal && this.elPrompt) {
      this.elPrompt.classList.remove('hidden');
      const nextChNum = ((this.combat.chapterIndex || 1) % CHAPTER_REALMS.length) + 1;
      const nextCh = CHAPTER_REALMS[nextChNum - 1];
      this.elPrompt.textContent = `[E] Enter Realm Ascension Portal → Chapter ${nextCh.chapter}: ${nextCh.name}`;
    } else if (nearShrine && this.elPrompt) {
      this.elPrompt.classList.remove('hidden');
      this.elPrompt.textContent = `[E] Rest & Kindle at ${nearShrine.name}`;
    } else if (this.elPrompt) {
      this.elPrompt.classList.add('hidden');
    }

    // 7. 3D Target Lock-On Reticle Projection
    const lockTarget = this.combat.lockedTarget;
    if (lockTarget && !lockTarget.isDead && camera && this.elLockReticle) {
      const worldTarget = lockTarget.pos.clone();
      worldTarget.y += (lockTarget.height || 1.9) * 0.65;
      worldTarget.project(camera);
      if (worldTarget.z < 1.0) {
        const sx = (worldTarget.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-worldTarget.y * 0.5 + 0.5) * window.innerHeight;
        this.elLockReticle.classList.remove('hidden');
        this.elLockReticle.style.left = `${sx}px`;
        this.elLockReticle.style.top = `${sy}px`;
        this.elLockReticle.classList.toggle('poise-broken', lockTarget.state === 'stagger');
      } else {
        this.elLockReticle.classList.add('hidden');
      }
    } else if (this.elLockReticle) {
      this.elLockReticle.classList.add('hidden');
    }

    // 8. Update Mini-Map Radar & Full Tactical Trail Map
    if (this.elZoneIndicator && zone) {
      const chIdx = this.combat.chapterIndex || 1;
      const baseZoneLabel = playerLoc.isBranch ? 'Zone II: Sunken Tidal Clearing' : zone.name;
      this.elZoneIndicator.textContent = chIdx > 1 ? `CH.${chIdx} • ${baseZoneLabel}` : baseZoneLabel;
    }
    if (this.elSpinePct) {
      this.elSpinePct.textContent = playerLoc.isBranch
        ? `BRANCH ${(playerLoc.u * 100).toFixed(0)}%`
        : `${(spineT * 100).toFixed(0)}% SPINE`;
    }

    this.elLimitAction?.classList.toggle('ready', p.limitGauge >= 100 || p.focus >= 2);
    this.mapRefreshTimer -= dt;
    const refreshMap = this.mapRefreshTimer <= 0;
    if (refreshMap) this.mapRefreshTimer = 0.1;
    if (refreshMap && this.miniCtx && this.elMiniMapCanvas) {
      this._renderTrailMapCanvas(
        this.miniCtx,
        this.elMiniMapCanvas.width,
        this.elMiniMapCanvas.height,
        false
      );
    }
    if (refreshMap && this.mapExpanded && this.fullCtx && this.elFullMapCanvas) {
      this._renderTrailMapCanvas(
        this.fullCtx,
        this.elFullMapCanvas.width,
        this.elFullMapCanvas.height,
        true
      );
    }
  }

  _worldToCanvas(x, z, w, h) {
    // World bounds of the Inverted-U Serpent's Spine:
    // X: [-144, 102], Z: [-126, 124]
    const minX = -144;
    const maxX = 102;
    const minZ = -126;
    const maxZ = 124;
    const pad = 22;
    const availW = w - pad * 2;
    const availH = h - pad * 2;

    const nx = (x - minX) / (maxX - minX);
    const nz = (z - minZ) / (maxZ - minZ);
    return {
      cx: pad + nx * availW,
      cy: pad + nz * availH,
    };
  }

  _hitTestShrineOnCanvas(cx, cy, w, h) {
    for (const sh of SHRINES) {
      const sp = this.topology.getSampleAt(sh.t).point;
      const { cx: sx, cy: sy } = this._worldToCanvas(sp.x, sp.z, w, h);
      const dist = Math.hypot(cx - sx, cy - sy);
      if (dist <= 18) return sh.zone;
    }
    return -1;
  }

  _renderTrailMapCanvas(ctx, w, h, detailed = false) {
    ctx.clearRect(0, 0, w, h);

    // Subtle dark obsidian backdrop grid
    ctx.fillStyle = detailed ? 'rgba(9, 12, 18, 0.94)' : 'rgba(8, 11, 16, 0.78)';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(130, 160, 195, 0.08)';
    ctx.lineWidth = 1;
    const step = detailed ? 40 : 28;
    for (let x = 0; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 1. Draw Zone 2 Left Branch ("Wandering Wight" Sunken Clearing)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i <= 32; i++) {
      const u = i / 32;
      const f = this.topology.getBranchSampleAt(u);
      const { cx, cy } = this._worldToCanvas(f.point.x, f.point.z, w, h);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.strokeStyle = 'rgba(88, 185, 165, 0.6)';
    ctx.lineWidth = detailed ? 8 : 4;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Branch clearing circle
    const branchEnd = this.topology.getBranchSampleAt(0.82).point;
    const bEndC = this._worldToCanvas(branchEnd.x, branchEnd.z, w, h);
    ctx.fillStyle = 'rgba(72, 175, 155, 0.25)';
    ctx.beginPath();
    ctx.arc(bEndC.cx, bEndC.cy, detailed ? 14 : 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Draw Main Inverted-U Serpent's Spine Corridor Width & Centerline
    const samples = 140;
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const f = this.topology.getSampleAt(t);
      const { cx, cy } = this._worldToCanvas(f.point.x, f.point.z, w, h);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.strokeStyle = 'rgba(185, 155, 110, 0.28)';
    ctx.lineWidth = detailed ? 16 : 9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // High-contrast golden-amber arterial centerline
    ctx.strokeStyle = 'rgba(235, 195, 125, 0.88)';
    ctx.lineWidth = detailed ? 3.0 : 1.8;
    ctx.stroke();
    ctx.restore();

    // 3. Draw Active vs Dissolved Obsidian Fog Seals (Triple-Lock Choke Gates) & Alive Enemies
    for (const enc of this.combat.encounters) {
      if (!enc.isBranch && enc.gateT) {
        const f = this.topology.getSampleAt(enc.gateT);
        const { cx, cy } = this._worldToCanvas(f.point.x, f.point.z, w, h);
        ctx.save();
        ctx.translate(cx, cy);
        const angle = Math.atan2(f.flatTangent.z, f.flatTangent.x);
        ctx.rotate(angle + Math.PI / 2);
        ctx.strokeStyle = !enc.cleared ? '#ff4422' : 'rgba(110, 220, 160, 0.45)';
        ctx.lineWidth = detailed ? 3 : 2;
        const barHalf = detailed ? 10 : 6;
        ctx.beginPath();
        ctx.moveTo(-barHalf, 0);
        ctx.lineTo(barHalf, 0);
        ctx.stroke();
        ctx.restore();
      }

      for (const enemy of enc.fighters) {
        if (enemy.isDead) continue;
        const { cx, cy } = this._worldToCanvas(enemy.pos.x, enemy.pos.z, w, h);
        ctx.save();
        ctx.fillStyle = enemy.isBoss ? '#ff3a28' : '#ff9d3b';
        const r = enemy.isBoss ? (detailed ? 6.5 : 4.2) : detailed ? 4.0 : 2.6;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        if (enemy.isBoss && detailed) {
          ctx.strokeStyle = 'rgba(255, 90, 60, 0.6)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // 4. Draw 5 Diegetic Shrines
    SHRINES.forEach((shrine, idx) => {
      const sp = this.topology.getSampleAt(shrine.t).point;
      const { cx, cy } = this._worldToCanvas(sp.x, sp.z, w, h);
      const kindled = this.world.shrineObjects[idx]?.discovered;

      ctx.save();
      ctx.fillStyle = kindled ? '#ffbf47' : '#58c4ff';
      ctx.strokeStyle = '#11161f';
      ctx.lineWidth = 2;
      const r = detailed ? 7 : 4.2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (detailed) {
        ctx.fillStyle = '#f5e7c6';
        ctx.font = '500 12px "Reincarnation HUD", sans-serif';
        ctx.fillText(`[${shrine.zone}] ${shrine.name}`, cx + 11, cy + 4);
      }
      ctx.restore();
    });

    // 5. Draw Player Vessel Position & Heading Arrow
    const p = this.combat.player;
    const { cx: px, cy: py } = this._worldToCanvas(p.pos.x, p.pos.z, w, h);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw)));
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#7cf0ff';
    ctx.shadowBlur = 8;
    const s = detailed ? 7 : 5;
    ctx.beginPath();
    ctx.moveTo(s * 1.35, 0);
    ctx.lineTo(-s, -s * 0.85);
    ctx.lineTo(-s * 0.45, 0);
    ctx.lineTo(-s, s * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
