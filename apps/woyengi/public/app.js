const root=document.documentElement;const body=document.body;const workspaceSelect=document.querySelector('#workspace-switcher');const toast=document.querySelector('[data-toast]');const scrim=document.querySelector('[data-scrim]');const inspectPanel=document.querySelector('[data-inspect-panel]');const intentInput=document.querySelector('#intent-input');
let snapshot;

const storedTheme=localStorage.getItem('woyengi-shell-theme');
if(storedTheme==='dark'){root.dataset.theme='dark';updateThemeButton()}

document.querySelector('[data-theme-toggle]').addEventListener('click',()=>{root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';localStorage.setItem('woyengi-shell-theme',root.dataset.theme);updateThemeButton()});
document.querySelector('[data-open-menu]').addEventListener('click',()=>setMenu(true));
document.querySelector('[data-close-menu]').addEventListener('click',()=>setMenu(false));
document.querySelector('[data-open-inspect]').addEventListener('click',openInspect);
document.querySelector('[data-close-inspect]').addEventListener('click',closeInspect);
scrim.addEventListener('click',()=>{closeInspect();setMenu(false)});

document.querySelectorAll('[data-intent-mode]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('[data-intent-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  intentInput.placeholder={Ask:'What would you like to understand?',Create:'What would you like to make?',Delegate:'What outcome should Woyengi move forward?'}[button.dataset.intentMode];
  intentInput.focus();
}));

document.querySelector('.intent-card').addEventListener('submit',event=>{
  event.preventDefault();const intent=intentInput.value.trim();
  if(!intent){intentInput.focus();announce('Start with the outcome you want.');return}
  document.querySelector('#composer-title').textContent=`Shaping: ${intent}`;
  document.querySelector('[data-composer-preview]').scrollIntoView({behavior:'smooth',block:'center'});
  announce('Composer preview updated. Your workspace has not been changed.');
});

document.querySelector('[data-create-app]').addEventListener('click',()=>activateComposer('Create'));
document.querySelector('[data-start-composer]').addEventListener('click',()=>activateComposer('Create'));
document.querySelectorAll('.nav-link').forEach(link=>link.addEventListener('click',()=>{
  document.querySelectorAll('.nav-link').forEach(item=>{item.classList.toggle('active',item===link);item.removeAttribute('aria-current')});
  link.setAttribute('aria-current','page');setMenu(false);
  if(link.dataset.view==='search')setTimeout(()=>intentInput.focus(),0);
}));

workspaceSelect.addEventListener('change',()=>void load(workspaceSelect.value));
document.addEventListener('keydown',event=>{
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();intentInput.focus();intentInput.select()}
  if(event.key==='Escape'){closeInspect();setMenu(false)}
});

void load();

async function load(workspaceId){
  body.dataset.loading='true';
  try{
    const query=workspaceId?`?workspace=${encodeURIComponent(workspaceId)}`:'';
    const response=await fetch(`/api/shell${query}`);
    if(!response.ok)throw new Error('Workspace unavailable');
    ({data:snapshot}=await response.json());render(snapshot);
  }catch(error){announce(error.message)}finally{delete body.dataset.loading}
}

function render(data){
  textAll('[data-principal-name]',data.principal.name);textAll('[data-principal-initials]',data.principal.initials);text('[data-greeting]',data.focus.greeting);text('[data-summary]',data.focus.summary);text('[data-active-work]',data.focus.activeWork);text('[data-waiting]',data.focus.waiting);text('[data-completed]',data.focus.completedThisWeek);text('#work-count',data.focus.activeWork);
  workspaceSelect.replaceChildren(...data.workspaces.map(item=>option(item.name,item.id,item.id===data.activeWorkspaceId,item.kind)));
  const workList=document.querySelector('[data-work-list]');workList.replaceChildren(...data.work.map(workCard));
  const inboxList=document.querySelector('[data-inbox-list]');inboxList.replaceChildren(...data.inbox.map(inboxCard));
  const appList=document.querySelector('[data-app-list]');appList.replaceChildren(...data.apps.map(appCard));
}

function workCard(item){const article=element('article','work-item');const main=element('div');const row=element('div','work-title-row');row.append(element('h3','',item.title),element('span',`status-pill ${item.status==='Waiting'?'waiting':''}`,item.status));const meta=element('div','work-meta');meta.append(element('span','collaborator-avatar',initials(item.collaborator)),element('span','',item.collaborator),element('span','','·'),element('span','',item.updated));main.append(row,meta);const side=element('div','work-progress');side.append(element('strong','',`${item.progress}%`));const track=element('span','progress-track');const fill=element('i');fill.style.width=`${Math.min(100,Math.max(0,item.progress))}%`;track.append(fill);side.append(track);article.append(main,side);return article}
function inboxCard(item){const article=element('article','attention-item');article.append(element('span',item.unread?'unread-mark':''));const content=element('span');content.append(element('strong','',item.title),element('small','',`${item.source} · ${item.age}`));article.append(content);return article}
function appCard(item){const article=element('article','app-card');article.style.setProperty('--app-accent',`var(--${item.accent})`);article.append(element('span','app-icon',item.name.charAt(0)),element('h3','',item.name),element('p','',item.description));const button=element('button','','→');button.type='button';button.setAttribute('aria-label',`Open ${item.name}`);article.append(button);return article}
function option(label,value,selected,kind){const node=document.createElement('option');node.textContent=`${kind==='organization'?'◆':'●'}  ${label}`;node.value=value;node.selected=selected;return node}
function element(tag,className='',content){const node=document.createElement(tag);if(className)node.className=className;if(content!==undefined)node.textContent=String(content);return node}
function text(selector,value){document.querySelector(selector).textContent=String(value)}function textAll(selector,value){document.querySelectorAll(selector).forEach(node=>{node.textContent=String(value)})}
function initials(value){return value.split(/\s+/).map(word=>word[0]).join('').slice(0,2).toUpperCase()}
function activateComposer(mode){document.querySelector(`[data-intent-mode="${mode}"]`).click();intentInput.scrollIntoView({behavior:'smooth',block:'center'})}
function openInspect(){inspectPanel.hidden=false;scrim.hidden=false;document.querySelector('[data-close-inspect]').focus()}
function closeInspect(){if(inspectPanel.hidden)return;inspectPanel.hidden=true;scrim.hidden=true;document.querySelector('[data-open-inspect]').focus()}
function setMenu(open){body.classList.toggle('menu-open',open);document.querySelector('[data-open-menu]').setAttribute('aria-expanded',String(open));scrim.hidden=!open}
function updateThemeButton(){const button=document.querySelector('[data-theme-toggle]');const dark=root.dataset.theme==='dark';button.textContent=dark?'☀':'☾';button.setAttribute('aria-label',dark?'Switch to light theme':'Switch to dark theme')}
function announce(message){toast.textContent=message;toast.hidden=false;clearTimeout(announce.timeout);announce.timeout=setTimeout(()=>{toast.hidden=true},3600)}
