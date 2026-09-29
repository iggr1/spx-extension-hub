(() => {
  const STORAGE_KEY = 'spxDockFlowShowRouteOrderQuantitiesV1';
  const DEFAULT_VISIBLE = true;

  let showRouteOrderQuantities = loadPreference();
  const originalRenderAssignmentStats = renderAssignmentStats;

  renderAssignmentStats = function configurableRenderAssignmentStats(assignmentTaskId) {
    if (!showRouteOrderQuantities) return '';
    return originalRenderAssignmentStats(assignmentTaskId);
  };

  initialize();

  function initialize() {
    injectRouteLayoutStyle();
    injectSetting();
    syncInput();
    bindEvents();
  }

  function injectRouteLayoutStyle() {
    if (document.getElementById('dockFlowRouteLayoutStyle')) return;

    const style = document.createElement('style');
    style.id = 'dockFlowRouteLayoutStyle';
    style.textContent = `
      .route-block.route-ready {
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
      }

      .dock-card.available {
        grid-template-rows: auto minmax(0, 1fr) auto;
      }

      .dock-card.available .route-block {
        display: none;
      }

      .dock-card.available .dock-name-block,
      .dock-card.available .status-badge,
      .dock-card.available .driver-block,
      .dock-card.available .times-grid {
        opacity: 1;
      }

      .dock-card.available .driver-block {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        text-align: center;
      }

      .dock-card.available .driver-block strong {
        color: var(--muted);
        font-size: clamp(12px, min(1.15vw, 1.9vh), 18px);
        font-weight: 850;
        line-height: 1.15;
      }

      .dock-card.available .time-item {
        opacity: 1;
      }
    `;

    document.head.appendChild(style);
  }

  function injectSetting() {
    if (document.getElementById('settingShowRouteOrderQuantities')) return;

    const visualSection = [...document.querySelectorAll('.settings-section')].find(section => (
      section.querySelector('.settings-section-title')?.textContent?.trim() === 'VisualizaÃ§Ã£o'
    ));
    const grid = visualSection?.querySelector('.settings-grid');
    if (!grid) return;

    const field = document.createElement('label');
    field.className = 'settings-field full-width';
    field.innerHTML = `
      <span class="settings-switch-row">
        <span>
          <span class="settings-field-label">Exibir quantidades de pedidos nas rotas</span>
          <small>Mostra os totais de pedidos e volumosos nos cards. Ao ocultar, essas estatÃ­sticas deixam de ser consultadas.</small>
        </span>
        <span class="settings-switch">
          <input id="settingShowRouteOrderQuantities" type="checkbox">
          <span aria-hidden="true"></span>
        </span>
      </span>
    `;

    grid.appendChild(field);
  }

  function bindEvents() {
    document.getElementById('settingsButton')?.addEventListener('click', syncInput);

    document.getElementById('settingsSaveButton')?.addEventListener('click', () => {
      const input = document.getElementById('settingShowRouteOrderQuantities');
      showRouteOrderQuantities = input?.checked !== false;
      savePreference(showRouteOrderQuantities);
      applyPreference();
    });

    document.getElementById('settingsResetButton')?.addEventListener('click', () => {
      showRouteOrderQuantities = DEFAULT_VISIBLE;
      savePreference(showRouteOrderQuantities);
      syncInput();
      applyPreference();
    });

    document.getElementById('settingsCancelButton')?.addEventListener('click', syncInput);
    document.getElementById('settingsCloseButton')?.addEventListener('click', syncInput);

    document.getElementById('settingsModal')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) syncInput();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') syncInput();
    });
  }

  function applyPreference() {
    try {
      renderAll();
      updateLiveTimes();
      scheduleGridFit();
    } catch {
    }
  }

  function syncInput() {
    const input = document.getElementById('settingShowRouteOrderQuantities');
    if (input) input.checked = showRouteOrderQuantities;
  }

  function loadPreference() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return DEFAULT_VISIBLE;
    return stored !== 'false';
  }

  function savePreference(value) {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  }
})();

(() => {
  const STATION_URL = 'https://spx.shopee.com.br/api/admin/basicserver/current_user/station_list/?count=50&status_list=0';
  const PLANNED_URL = 'https://spx.shopee.com.br/spx_delivery/admin/assignment/assignment_task/detail/planned_order/search';
  const SCANNED_URL = 'https://spx.shopee.com.br/api/in-station/lmhub/audit/parcel/list';
  const progressCache = new Map();
  let stationCache = { id: 0, expiresAt: 0 };
  let frame = 0;

  initialize();

  function initialize() {
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });

    document.addEventListener('click', event => {
      if (event.target.closest('.dock-card[data-dock-id]')) scheduleSync();
    }, true);

    window.setInterval(scheduleSync, 1000);
    scheduleSync();
  }

  function scheduleSync() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      void syncAutoAddProgress();
    });
  }

  async function syncAutoAddProgress() {
    const dialog = document.querySelectoŠ	Ë™ØÚËY]Z[ËYX[ÙÖÛÜ[—IÊNÂˆÛÛœÝ\ÝHX[ÙÏËœ]Y\žTÙ[XÝÜŠ	Ë™ØÚËY]Z[ËX›ÙH	ÊNÂˆYˆ
[\Ý
H™]\›ŽÂ‚ˆÛÛœÝ\ÜÚYÛ›Y[\ÚÒYH™XY\ÜÚYÛ›Y[\ÚÒY
\Ý
NÂˆYˆ
X\ÜÚYÛ›Y[\ÚÒY
H™]\›ŽÂ‚ˆÛÛœÝ›ÝÈH[œÝ\™T›ÝÊ\Ý
NÂˆÛÛœÝ˜[YHH›ÝËœ]Y\žTÙ[XÝÜŠ	Ù	ÊNÂˆÛÛœÝ˜[Y][Û•\ÚÒYH™XY˜[Y][Û•\ÚÒY

NÂ‚ˆYˆ
]˜[Y][Û•\ÚÒY
HÂˆ˜[YK^ÛÛ[H	ø %	ÎÂˆ™]\›ŽÂˆB‚ˆÛÛœÝÞXÛP]H[X™\ŠÝ]OË™™]ÚY]
NÂˆÛÛœÝÙ^HH	Ý˜[Y][Û•\ÚÒY_	Ø\ÜÚYÛ›Y[\ÚÒYXÂˆÛÛœÝØXÚYH›ÙÜ™\ÜÐØXÚK™Ù]
Ù^JNÂ‚ˆYˆ
ØXÚYËœÝ]\ÈOOH	Ü™XYIÈ	‰ˆØXÚY˜ÞXÛP]OOHÞXÛP]
HÂˆ™[™\”›ÙÜ™\ÜÊ˜[YKØXÚY
NÂˆ™]\›ŽÂˆB‚ˆYˆ
ØXÚYËœÝ]\ÈOOH	ÛØY[™ÉÈ	‰ˆØXÚY˜ÞXÛP]OOHÞXÛP]
HÂˆ˜[YK^ÛÛ[H	Ð]X[^˜[™Ë‹‹‰ÎÂˆ™]\›ŽÂˆB‚ˆ˜[YK^ÛÛ[H	Ð]X[^˜[™Ë‹‹‰ÎÂˆ›ÙÜ™\ÜÐØXÚKœÙ]
Ù^KÈÝ]\Îˆ	ÛØY[™ÉËÞXÛP]JNÂ‚ˆžHÂˆÛÛœÝ›ÙÜ™\ÜÈH]ØZ]™]Ú]]ÐY›ÙÜ™\ÜÊ\ÜÚYÛ›Y[\ÚÒY˜[Y][Û•\ÚÒY
NÂˆ›ÙÜ™\ÜÐØXÚKœÙ]
Ù^KÈÝ]\Îˆ	Ü™XYIËÞXÛP]‹‹œ›ÙÜ™\ÜÈJNÂˆHØ]ÚÂˆ›ÙÜ™\ÜÐØXÚKœÙ]
Ù^KÈÝ]\Îˆ	Ù\œ›Ü‰ËÞXÛP]JNÂˆB‚ˆØÚY[TÞ[˜Ê
NÂˆB‚ˆ[˜Ý[Ûˆ™XY\ÜÚYÛ›Y[\ÚÒY
\Ý
HÂˆ›Üˆ
ÛÛœÝ›ÝÈÙˆ\Ýœ]Y\žTÙ[XÝÜ[
	ÎœØÛÜHˆ]‰ÊJHÂˆYˆ
›ÝËœ]Y\žTÙ[XÝÜŠ	Ù	ÊOË^ÛÛ[Ëš[J
HOOH	ÐU	ÊHÛÛ[YNÂˆÛÛœÝ˜[YHH›ÝËœ]Y\žTÙ[XÝÜŠ	Ù	ÊOË^ÛÛ[Ëš[J
H	ÉÎÂˆ™]\›ˆ×UÐKVŒNWJÉÚK\Ý
˜[YJHÈ˜[YKÕ\\Ø\ÙJ
Hˆ	ÉÎÂˆBˆ™]\›ˆ	ÉÎÂˆB‚ˆ[˜Ý[Ûˆ™XY˜[Y][Û•\ÚÒY

HÂˆÛÛœÝ˜[YHHÝš[™ÊÝ]OË˜[Y][Û”›ÙÜ™\ÜÏË\ÚÒY	ÉÊKš[J
NÂˆ™]\›ˆ×••ÐKVŒNWJÉÚK\Ý
˜[YJHÈ˜[YKÕ\\Ø\ÙJ
Hˆ	ÉÎÂˆB‚ˆ[˜Ý[Ûˆ[œÝ\™T›ÝÊ\Ý
HÂˆ]›ÝÈH\Ýœ]Y\žTÙ[XÝÜŠ	ÖÙ]KX]]ØY\›ÙÜ™\Ü×IÊNÂˆYˆ
›ÝÊH™]\›ˆ›ÝÎÂ‚ˆ›ÝÈHØÝ[Y[˜Ü™X]Q[[Y[
	Ù]‰ÊNÂˆ›ÝË™]\Ù]˜]]ØY›ÙÜ™\ÜÈH	ÝYIÎÂˆ›ÝËš[›™\’SH	Ï]]ÐYÙ]X[^˜[™Ë‹‹Ù‰ÎÂ‚ˆÛÛœÝÜ™\”›ÝÈHË‹‹›\Ýœ]Y\žTÙ[XÝÜ[
	ÎœØÛÜHˆ]‰ÊWBˆ™š[™
][HOˆ][Kœ]Y\žTÙ[XÝâ‚vGBr“òçFW‡D6öçFVçCòçG&–Ò‚’ÓÓÒuVF–F÷2FBr“° ¢–b†÷&FW%&÷sòææW‡E6–&Æ–ær’Æ—7Bæ–ç6W'D&Vf÷&R‡&÷rÂ÷&FW%&÷rææW‡E6–&Æ–ær“°¢VÇ6RÆ—7BæVæD6†–ÆB‡&÷r“° ¢&WGW&â&÷s°¢Ð ¢gVæ7F–öâ&VæFW%&öw&W72‡fÇVRÂ&öw&W72’°¢–b‚&öw&W72çF÷FÂ’°¢fÇVRçFW‡D6öçFVçBÒu&÷F6VÒWFôFBs°¢&WGW&ã°¢Ð ¢6öç7BÆöFVDÆ&VÂÒ&öw&W72æÆöFVBÓÓÒòv&—Fòr¢v&—F÷2s°¢6öç7BVæF–ætÆ&VÂÒ&öw&W72çVæF–ærÓÓÒòvfÇFæFòr¢vfÇFæFòs°¢fÇVRçFW‡D6öçFVçBÒG·&öw&W72æÆöFVGÒG¶ÆöFVDÆ&VÇÒ+rG·&öw&W72çVæF–æwÒG·VæF–ætÆ&VÇÖ°¢Ð ¢7–æ2gVæ7F–öâfWF6„WFôFE&öw&W72†76–væÖVçEF6´–BÂfÆ–FF–öåF6´–B’°¢6öç7B7FF–öä–BÒv—BvWE7FF–öä–B‚“° ¢6öç7B66ææVE&×2ÒæWrU$Å6V&6…&×2‡°¢fÆ–FF–öå÷F6µö–C¢fÆ–FF–öåF6´–BÀ¢F&vWEö–C¢76–væÖVçEF6´–BÀ¢VF—E÷F&vWE÷G—S¢s"rÀ¢vUöæó¢srÀ¢6÷VçC¢s““’rÀ¢&6VÅ÷66å÷7FGW3¢s"rÀ¢6†—ÖVçEö–C¢rp¢Ò“° ¢6öç7B&W7öç6RÒv—BÆöFW$'&–FvRç&WVW7B‚væWGv÷&²æfWF6„&F6‚rÂ°¢&öf–ÆT–C¢w7‚rÀ¢&WVW7G3¢°¢°¢¶W“¢vWFöFB×ÆææVBrÀ¢W&Ã¢ÄääTEõU$ÂÀ¢ÖWF†öC¢uõ5BrÀ¢&öG“¢²76–væÖVçE÷F6µö–C¢76–væÖVçEF6´–BÂ7FF–öåö–C¢7FF–öä–BÐ¢ÒÀ¢°¢¶W“¢vWFöFB×66ææVBrÀ¢W&Ã¢Gµ44ääTEõU$ÇÓòG·66ææVE&×2çFõ7G&–ær‚—ÖÀ¢ÖWF†öC¢ttUBp¢Ð¢Ð¢Ò“° ¢6öç7BÆææVE&W7VÇBÒ&W7öç6Sòç&W7VÇG3òå²vWFöFB×ÆææVBuÓ°¢6öç7B66ææVE&W7VÇBÒ&W7öç6Sòç&W7VÇG3òå²vWFöFB×66ææVBuÓ° ¢–b‚ÆææVE&W7VÇCòæö²ÇÂ66ææVE&W7VÇCòæö²’°¢F‡&÷ræWrW'&÷"‚tì:6òfö’÷7<:×fVÂGVÆ—¦"òWFôFBâr“°¢Ð ¢6öç7BÆææVDÆ—7BÒ'&’æ—4'&’‡ÆææVE&W7VÇBæFFòæFFòæÆ—7B¢òÆææVE&W7VÇBæFFæFFæÆ—7@¢¢µÓ°¢6öç7B66ææVDÆ—7BÒ'&’æ—4'&’‡66ææVE&W7VÇBæFFòæFFòæÆ—7B¢ò66ææVE&W7VÇBæFFæFFæÆ—7@¢¢µÓ° ¢6öç7BÆææVD–G2ÒæWr6WB‚“°¢6öç7B66ææVD–G2ÒæWr6WB‚“° ¢f÷"†6öç7B—FVÒöbÆææVDÆ—7B’°¢–b„çVÖ&W"†—FVÓòæ÷&FW%öEöÆ–æ¶vR’ÓÒ"’6öçF–çVS°¢6öç7B6†—ÖVçD–BÒ7G&–ær†—FVÓòç6†—ÖVçEö–BÇÂrr’çG&–Ò‚’çFõWW$66R‚“°¢–b‡6†—ÖVçD–B’ÆææVD–G2æFB‡6†—ÖVçD–B“°¢Ð ¢f÷"†6öç7B—FVÒöb66ææVDÆ—7B’°¢6öç7B6†—ÖVçD–BÒ7G&–ær†—FVÓòç6†—ÖVçEö–BÇÂrr’çG&–Ò‚’çFõWW$66R‚“°¢–b‡6†—ÖVçD–B’66ææVD–G2æFB‡6†—ÖVçD–B“°¢Ð ¢ÆWBÆöFVBÒ°¢f÷"†6öç7B6†—ÖVçD–BöbÆææVD–G2’°¢–b‡66ææVD–G2æ†2‡6†—ÖVçD–B’’ÆöFVB³Ò°¢Ð ¢&WGW&â°¢F÷FÃ¢ÆææVD–G2ç6—¦RÀ¢ÆöFVBÀ¢VæF–æs¢ÖF‚æÖ‚ƒÂÆææVD–G2ç6—¦RÒÆöFVB¢Ó°¢Ð ¢7–æ2gVæ7F–öâvWE7FF–öä–B‚’°¢–b‡7FF–öä66†Ræ–Bâbb7FF–öä66†RæW‡—&W4BâFFRææ÷r‚’’&WGW&â7FF–öä66†Ræ–C° ¢6öç7B&W7öç6RÒv—BÆöFW$'&–FvRç&WVW7B‚væWGv÷&²æfWF6„&F6‚rÂ°¢&öf–ÆT–C¢w7‚rÀ¢&WVW7G3¢·²¶W“¢vWFöFB×7FF–öârÂW&Ã¢5DD”ôåõU$ÂÂÖWF†öC¢ttUBrÕÐ¢Ò“°¢6öç7B&W7VÇBÒ&W7öç6Sòç&W7VÇG3òå²vWFöFB×7FF–öâuÓ° ¢–b‚&W7VÇCòæö²’F‡&÷ræWrW'&÷"‚tì:6òfö’÷7<:×fVÂ–FVçF–f–6"W7F:|:6òâr“° ¢6öç7B7FF–öä–BÒçVÖ&W"‡&W7VÇBæFFòæFFòæ7W'&VçE÷7FF–öåö–BÇÂ“°¢–b‚çVÖ&W"æ—56fT–çFVvW"‡7FF–öä–B’ÇÂ7FF–öä–BÃÒ’F‡&÷ræWrW'&÷"‚tW7F:|:6ò–çl:Æ–Fâr“° ¢7FF–öä66†RÒ²–C¢7FF–öä–BÂW‡—&W4C¢FFRææ÷r‚’²¢c¢Ó°¢&WGW&â7FF–öä–C°¢Ð§Ò’‚“° 